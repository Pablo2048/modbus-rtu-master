class ModbusRTUMaster {
    // Define Modbus Function Codes
    static FUNCTION_CODES = {
        READ_COILS: 0x01,
        READ_DISCRETE_INPUTS: 0x02,
        READ_HOLDING_REGISTERS: 0x03,
        READ_INPUT_REGISTERS: 0x04,
        WRITE_SINGLE_COIL: 0x05,
        WRITE_SINGLE_REGISTER: 0x06,
        WRITE_MULTIPLE_COILS: 0x0F,
        WRITE_MULTIPLE_REGISTERS: 0x10,
    };

    constructor(config = {}) {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.baudRate = config.baudRate || 9600;
        this.dataBits = config.dataBits || 8;
        this.stopBits = config.stopBits || 1;
        this.parity = config.parity || 'none';
        this.flowControl = config.flowControl || 'none';
        this.timeout = config.timeout || 2000; // Default timeout is 2 seconds

        navigator.serial.addEventListener('disconnect', (event) => {
            TRACE_WARNING("mbrtu", 'Port disconnected, attempting to reconnect...');
            this.handleDeviceLost();
        });

        navigator.serial.addEventListener('connect', (event) => {
            TRACE_INFO("mbrtu", 'Device connected:', event);
            this.reconnect();
        });
    }

    async connect() {
        try {
            this.port = await navigator.serial.requestPort();
            await this.openPort();
            TRACE_VERBOSE("mbrtu", 'Connected to serial port with configuration:', {
                baudRate: this.baudRate,
                dataBits: this.dataBits,
                stopBits: this.stopBits,
                parity: this.parity,
                flowControl: this.flowControl,
                timeout: this.timeout
            });
        } catch (error) {
            TRACE_ERROR("mbrtu", 'Failed to open serial port:', error);
        }
    }

    async openPort() {
        await this.port.open({
            baudRate: this.baudRate,
            dataBits: this.dataBits,
            stopBits: this.stopBits,
            parity: this.parity,
            flowControl: this.flowControl
        });
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();
    }

    async disconnect() {
        TRACE_ERROR("mbrtu", "Disconnect.");
        try {
            if (this.reader) {
                await this.reader.cancel();
                await this.reader.releaseLock();
                this.reader = null;
            }
            if (this.writer) {
                await this.writer.releaseLock();
                this.writer = null;
            }
            if (this.port) {
                await this.port.close();
                this.port = null;
                TRACE_INFO("mbrtu", 'Serial port closed');
            }
        } catch (error) {
            TRACE_ERROR("mbrtu", 'Error during disconnect:', error);
        }
    }

    async handleDeviceLost() {
        TRACE_WARNING("mbrtu", 'Attempting to reconnect...');
        await this.disconnect();
        this.reconnect();
    }

    reconnect() {
        setTimeout(async () => {
            try {
                const ports = await navigator.serial.getPorts();
                if (ports.length > 0) {
                    this.port = ports[0];
                    if (!this.port.readable && !this.port.writable) {
                        await this.openPort();
                        TRACE_INFO("mbrtu", 'Reconnected to serial port.');
                    } else {
                        TRACE_WARNING("mbrtu", 'Port is already open. Skipping open operation.');
                    }
                } else {
                    TRACE_WARNING("mbrtu", 'Port not found, retrying...');
                    this.reconnect();
                }
            } catch (error) {
                TRACE_ERROR("mbrtu", 'Reconnect failed:', error);
                this.reconnect();
            }
        }, 1000); // Retry every 1 second
    }

    async readHoldingRegisters(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, ModbusRTUMaster.FUNCTION_CODES.READ_HOLDING_REGISTERS, startAddress, quantity);
        return this.parseRegisterValues(response, quantity);
    }

    async readInputRegisters(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, ModbusRTUMaster.FUNCTION_CODES.READ_INPUT_REGISTERS, startAddress, quantity);
        return this.parseRegisterValues(response, quantity);
    }

    async readCoils(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, ModbusRTUMaster.FUNCTION_CODES.READ_COILS, startAddress, quantity);
        return this.parseCoilValues(response, quantity);
    }

    async readDiscreteInputs(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, ModbusRTUMaster.FUNCTION_CODES.READ_DISCRETE_INPUTS, startAddress, quantity);
        return this.parseCoilValues(response, quantity);
    }

    async readRegisters(slaveId, functionCode, startAddress, quantity) {
        const frameLength = 8; // Request frame length for read operations
        // This check is not very useful as request frame for reads is fixed at 8 bytes.
        // Max PDU is 253, Max ADU is 256.
        // if (frameLength > 250) {
        //     throw new Error('Read frame length exceeded: frame too long.');
        // }

        const request = this._buildReadRequest(slaveId, functionCode, startAddress, quantity);
        TRACE_VERBOSE("mbrtu", "Send read request", request);
        await this.sendRequest(request);

        // Determine expected response length based on function code
        let expectedPduDataLength;
        if (functionCode === ModbusRTUMaster.FUNCTION_CODES.READ_HOLDING_REGISTERS || functionCode === ModbusRTUMaster.FUNCTION_CODES.READ_INPUT_REGISTERS) {
            expectedPduDataLength = 1 + quantity * 2; // byte count + register data
        } else if (functionCode === ModbusRTUMaster.FUNCTION_CODES.READ_COILS || functionCode === ModbusRTUMaster.FUNCTION_CODES.READ_DISCRETE_INPUTS) {
            expectedPduDataLength = 1 + Math.ceil(quantity / 8); // byte count + coil data
        } else {
            throw new Error(`Unknown function code for read operation: ${functionCode}`);
        }
        // Total ADU length = Slave ID (1) + Function Code (1) + PDU Data Length + CRC (2)
        const expectedAduResponseLength = 1 + 1 + expectedPduDataLength + 2;
        return await this._receiveResponse(slaveId, functionCode, expectedAduResponseLength);
    }

    /**
     * @private
     * Builds a Modbus request frame for read operations.
     * @param {number} slaveId - The slave ID.
     * @param {number} functionCode - The function code.
     * @param {number} address - The starting address.
     * @param {number} quantity - The quantity of items to read.
     * @returns {Uint8Array} The request frame.
     */
    _buildReadRequest(slaveId, functionCode, address, quantity) {
        const request = new Uint8Array(8); // Read requests are always 8 bytes
        request[0] = slaveId;
        request[1] = functionCode;
        request[2] = (address >> 8) & 0xFF;    // Start Address High
        request[3] = address & 0xFF;         // Start Address Low
        request[4] = (quantity >> 8) & 0xFF; // Quantity High
        request[5] = quantity & 0xFF;        // Quantity Low
        const crc = this.calculateCRC(request.subarray(0, 6));
        request[6] = crc & 0xFF;
        request[7] = (crc >> 8) & 0xFF;
        return request;
    }

    /**
     * @private
     * Builds a Modbus request frame for Write Single Coil operation.
     * @param {number} slaveId - The slave ID.
     * @param {number} address - The coil address.
     * @param {number} outputValue - The value to write (0xFF00 for ON, 0x0000 for OFF).
     * @returns {Uint8Array} The request frame.
     */
    _buildWriteSingleCoilRequest(slaveId, address, outputValue) {
        const request = new Uint8Array(8); // Write Single Coil requests are always 8 bytes
        request[0] = slaveId;
        request[1] = ModbusRTUMaster.FUNCTION_CODES.WRITE_SINGLE_COIL;
        request[2] = (address >> 8) & 0xFF;    // Coil Address High
        request[3] = address & 0xFF;         // Coil Address Low
        request[4] = (outputValue >> 8) & 0xFF; // Output Value High
        request[5] = outputValue & 0xFF;        // Output Value Low
        const crc = this.calculateCRC(request.subarray(0, 6));
        request[6] = crc & 0xFF;
        request[7] = (crc >> 8) & 0xFF;
        return request;
    }

    /**
     * @private
     * Builds a Modbus request frame for Write Multiple Coils operation.
     * @param {number} slaveId - The slave ID.
     * @param {number} address - The starting coil address.
     * @param {number} quantity - The quantity of coils to write.
     * @param {number} byteCount - The number of bytes of coil data.
     * @param {Uint8Array} coilBytes - The coil data bytes.
     * @returns {Uint8Array} The request frame.
     */
    _buildWriteMultipleCoilsRequest(slaveId, address, quantity, byteCount, coilBytes) {
        const requestPdu = new Uint8Array(6 + byteCount); // FC (1) + Address (2) + Quantity (2) + ByteCount (1) + CoilBytes (byteCount)
        requestPdu[0] = ModbusRTUMaster.FUNCTION_CODES.WRITE_MULTIPLE_COILS;
        requestPdu[1] = (address >> 8) & 0xFF;
        requestPdu[2] = address & 0xFF;
        requestPdu[3] = (quantity >> 8) & 0xFF;
        requestPdu[4] = quantity & 0xFF;
        requestPdu[5] = byteCount;
        requestPdu.set(coilBytes, 6);

        const requestAdu = new Uint8Array(1 + requestPdu.length + 2); // SlaveID + PDU + CRC
        requestAdu[0] = slaveId;
        requestAdu.set(requestPdu, 1);

        const crc = this.calculateCRC(requestAdu.subarray(0, 1 + requestPdu.length));
        requestAdu[1 + requestPdu.length] = crc & 0xFF;
        requestAdu[1 + requestPdu.length + 1] = (crc >> 8) & 0xFF;
        return requestAdu;
    }
    
    /**
     * @private
     * Builds a Modbus request frame for Write Single Register operation.
     * @param {number} slaveId - The slave ID.
     * @param {number} address - The register address.
     * @param {number} value - The 16-bit value to write to the register.
     * @returns {Uint8Array} The request frame.
     */
    _buildWriteSingleRegisterRequest(slaveId, address, value) {
        const request = new Uint8Array(8); // Write Single Register requests are always 8 bytes
        request[0] = slaveId;
        request[1] = ModbusRTUMaster.FUNCTION_CODES.WRITE_SINGLE_REGISTER;
        request[2] = (address >> 8) & 0xFF;    // Register Address High
        request[3] = address & 0xFF;         // Register Address Low
        request[4] = (value >> 8) & 0xFF;    // Register Value High
        request[5] = value & 0xFF;         // Register Value Low
        const crc = this.calculateCRC(request.subarray(0, 6));
        request[6] = crc & 0xFF;
        request[7] = (crc >> 8) & 0xFF;
        return request;
    }

    calculateCRC(buffer) {
        let crc = 0xFFFF;
        for (let pos = 0; pos < buffer.length; pos++) {
            crc ^= buffer[pos];
            for (let i = 8; i !== 0; i--) {
                if ((crc & 0x0001) !== 0) {
                    crc >>= 1;
                    crc ^= 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }

    async sendRequest(request) {
        await this.writer.write(request);
        TRACE_VERBOSE("mbrtu", 'Request sent:', request);
    }

    /**
     * @private
     * Receives a Modbus response frame.
     * @param {number} slaveId - The expected slave ID in the response.
     * @param {number} functionCode - The expected function code in the response.
     * @param {number} expectedAduLength - The total expected length of the ADU (including slave ID, FC, data, and CRC).
     * @returns {Promise<Uint8Array>} A promise that resolves with the validated response frame.
     * @throws {Error} If there's a timeout, CRC error, Modbus exception, or other communication error.
     */
    async _receiveResponse(slaveId, functionCode, expectedAduLength) {
        let responseFrame = new Uint8Array(expectedAduLength); // Initialize with fixed expected length
        let bytesReceived = 0;
        let actualExpectedAduLength = expectedAduLength; // Can change if an exception is detected

        try {
            await Promise.race([
                (async () => {
                    let buffer = new Uint8Array(256); // Max Modbus ADU size
                    while (bytesReceived < actualExpectedAduLength) {
                        const { value, done } = await this.reader.read();
                        if (done) throw new Error('Device has been lost during read.');
                        
                        // Copy new data into a temporary larger buffer if needed
                        if (bytesReceived + value.length > buffer.length) {
                            const newBuffer = new Uint8Array(bytesReceived + value.length + 50); // Add some extra space
                            newBuffer.set(buffer.subarray(0, bytesReceived), 0);
                            buffer = newBuffer;
                        }
                        buffer.set(value, bytesReceived);
                        bytesReceived += value.length;

                        // Check for Modbus exception response early (Slave ID, Func Code + 0x80, Exception Code, CRC H, CRC L) = 5 bytes
                        if (bytesReceived >= 2 && (buffer[1] & 0x80) && buffer[0] === slaveId) {
                             // If it's an exception for this function code
                            if ((buffer[1] ^ 0x80) === functionCode) {
                                actualExpectedAduLength = 5; // Exception response is always 5 bytes
                                // If we've already received enough for an exception, break
                                if (bytesReceived >= actualExpectedAduLength) break; 
                            }
                        }
                    }
                    responseFrame = buffer.subarray(0, bytesReceived);
                })(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout: No response received within ${this.timeout}ms for FC ${functionCode}. Expected ${actualExpectedAduLength} bytes.`)), this.timeout)
                )
            ]);
            
            if (bytesReceived < actualExpectedAduLength && !(responseFrame[1] & 0x80 && bytesReceived === 5) ) {
                 throw new Error(`Incomplete response: Received ${bytesReceived} bytes, expected ${actualExpectedAduLength} bytes.`);
            }
            
            // Final trim to actualExpectedAduLength if more was read due to timing
            if (bytesReceived > actualExpectedAduLength) {
                responseFrame = responseFrame.subarray(0, actualExpectedAduLength);
            }


            // Validate Slave ID
            if (responseFrame[0] !== slaveId) {
                throw new Error(`Invalid Slave ID: Expected ${slaveId}, received ${responseFrame[0]}`);
            }
            
            // Check for Modbus exception
            if (responseFrame[1] & 0x80) {
                if ((responseFrame[1] ^ 0x80) === functionCode) { // Check if the exception function code matches the request
                    if (responseFrame.length !== 5) {
                         throw new Error(`Invalid exception response length: Received ${responseFrame.length} bytes, expected 5.`);
                    }
                    const exceptionCode = responseFrame[2];
                    // CRC check for exception response
                    const dataWithoutCRCex = responseFrame.subarray(0, 3); // SID, FC_ERR, ERR_CODE
                    const receivedCRCex = (responseFrame[4] << 8) | responseFrame[3]; // CRC is LSB first
                    const calculatedCRCex = this.calculateCRC(dataWithoutCRCex);
                    if (calculatedCRCex !== receivedCRCex) {
                        throw new Error(`CRC Error in exception response: Calculated ${calculatedCRCex}, received ${receivedCRCex}. Response: ${responseFrame}`);
                    }
                    throw new Error(`Modbus Exception Code: ${this.getExceptionMessage(exceptionCode)} (Function: ${functionCode}, Code: ${exceptionCode})`);
                } else {
                    // This case should ideally not happen if slave responds correctly
                    throw new Error(`Received error for unexpected function code. Requested ${functionCode}, got error for ${responseFrame[1] ^ 0x80}`);
                }
            }

            // Validate function code for normal response
            if (responseFrame[1] !== functionCode) {
                throw new Error(`Invalid Function Code: Expected ${functionCode}, received ${responseFrame[1]}`);
            }
            
            // Validate CRC for normal response
            const dataWithoutCRC = responseFrame.subarray(0, responseFrame.length - 2);
            const receivedCRC = (responseFrame[responseFrame.length - 1] << 8) | responseFrame[responseFrame.length - 2]; // CRC is LSB first
            const calculatedCRC = this.calculateCRC(dataWithoutCRC);

            if (calculatedCRC === receivedCRC) {
                TRACE_VERBOSE("mbrtu", 'Received valid response:', responseFrame);
                return responseFrame;
            } else {
                throw new Error(`CRC Error: Calculated CRC ${calculatedCRC} does not match received CRC ${receivedCRC}. Response: ${responseFrame}`);
            }
        } catch (error) {
            TRACE_ERROR("mbrtu", `Error receiving response for FC ${functionCode}:`, error.message, error.stack);
            // Attempt to clear the serial buffer by cancelling the reader
            if (this.reader) {
                try {
                    // A short read to attempt to clear any pending data after cancel
                    const abortController = new AbortController();
                    const abortSignal = abortController.signal;
                    setTimeout(() => abortController.abort(), 50); // Quick timeout for this clear attempt
                    await this.reader.read({ signal: abortSignal }).catch(() => {}); // Ignore error from this read
                    
                    await this.reader.cancel().catch(e => TRACE_ERROR("mbrtu", "Error cancelling reader:", e)); // Log cancel error but continue
                    await this.reader.releaseLock().catch(e => TRACE_ERROR("mbrtu", "Error releasing lock:", e)); // Log release error
                } catch (cancelError) {
                    TRACE_ERROR("mbrtu", "Exception during reader cancellation/release:", cancelError);
                } finally {
                    this.reader = null; // Ensure reader is nullified
                    if (this.port && this.port.readable) { // Check if port and readable stream still exist
                       try {
                           this.reader = this.port.readable.getReader();
                       } catch (getReaderError){
                           TRACE_ERROR("mbrtu", "Failed to re-acquire reader:", getReaderError);
                           // This might indicate a more severe port issue
                       }
                    } else {
                        TRACE_WARNING("mbrtu", "Port or readable stream not available to re-acquire reader.");
                    }
                }
            }
            if (error.message.includes('Device has been lost')) {
                await this.handleDeviceLost(); // This will attempt to reconnect
            }
            throw error; // Re-throw the original error
        }
    }

    getExceptionMessage(code) {
        const exceptionMessages = {
            0x01: 'Illegal Function',
            0x02: 'Illegal Data Address',
            0x03: 'Illegal Data Value',
            0x04: 'Slave Device Failure',
            0x05: 'Acknowledge',
            0x06: 'Slave Device Busy',
            0x08: 'Memory Parity Error',
            0x0A: 'Gateway Path Unavailable',
            0x0B: 'Gateway Target Device Failed to Respond'
        };
        return exceptionMessages[code] || `Unknown Error (Code: ${code})`;
    }

    /**
     * Writes a single coil to a Modbus slave device.
     * @param {number} slaveId - The ID of the slave device.
     * @param {number} address - The address of the coil to write.
     * @param {boolean} value - The value to write to the coil (true for ON, false for OFF).
     * @returns {Promise<boolean>} A promise that resolves to true if the write was successful.
     * @throws {Error} If the write operation fails or a Modbus exception occurs.
     */
    async writeSingleCoil(slaveId, address, value) {
        const outputValue = value ? 0xFF00 : 0x0000; // ON is 0xFF00, OFF is 0x0000

        const request = this._buildWriteSingleCoilRequest(slaveId, address, outputValue);
        TRACE_VERBOSE("mbrtu", "Send writeSingleCoil request", request);
        await this.sendRequest(request);

        // Expected response for Write Single Coil is an echo of the request (8 bytes)
        const expectedAduResponseLength = 8;
        const response = await this._receiveResponse(slaveId, ModbusRTUMaster.FUNCTION_CODES.WRITE_SINGLE_COIL, expectedAduResponseLength);

        // Validate the response: it should be an echo of the request PDU (excluding CRC)
        // Request: [SlaveID, FuncCode, AddressHI, AddressLO, ValueHI, ValueLO, CRCHI, CRCLO]
        // Response: [SlaveID, FuncCode, AddressHI, AddressLO, ValueHI, ValueLO, CRCHI, CRCLO]
        if (response.length !== 8) {
            throw new Error(`WriteSingleCoil: Invalid response length. Expected 8, got ${response.length}`);
        }

        for (let i = 0; i < 6; i++) { // Compare first 6 bytes (SlaveID to ValueLO)
            if (request[i] !== response[i]) {
                throw new Error(
                    `WriteSingleCoil: Response mismatch. Request: [${request.slice(0,6).join(',')}] Response: [${response.slice(0,6).join(',')}]`
                );
            }
        }
        TRACE_INFO("mbrtu", `writeSingleCoil successful to slave ${slaveId}, address ${address}, value ${value}`);
        return true;
    }

    /**
     * Writes a single register to a Modbus slave device.
     * @param {number} slaveId - The ID of the slave device.
     * @param {number} address - The address of the register to write (0x0000 to 0xFFFF).
     * @param {number} value - The 16-bit value to write to the register (0 to 65535).
     * @returns {Promise<boolean>} A promise that resolves to true if the write was successful.
     * @throws {Error} If the write operation fails, value is out of range, or a Modbus exception occurs.
     */
    async writeSingleRegister(slaveId, address, value) {
        if (value < 0 || value > 0xFFFF) {
            throw new Error(`Invalid register value: ${value}. Must be between 0 and 65535.`);
        }
        if (address < 0 || address > 0xFFFF) {
            throw new Error(`Invalid register address: ${address}. Must be between 0x0000 and 0xFFFF.`);
        }

        const request = this._buildWriteSingleRegisterRequest(slaveId, address, value);
        TRACE_VERBOSE("mbrtu", "Send writeSingleRegister request", request);
        await this.sendRequest(request);

        // Expected response for Write Single Register is an echo of the request (8 bytes)
        const expectedAduResponseLength = 8;
        const response = await this._receiveResponse(slaveId, ModbusRTUMaster.FUNCTION_CODES.WRITE_SINGLE_REGISTER, expectedAduResponseLength);

        // Validate the response: it should be an echo of the request PDU (excluding CRC)
        // Request: [SlaveID, FuncCode, AddressHI, AddressLO, ValueHI, ValueLO, CRCLO, CRCHI]
        // Response: [SlaveID, FuncCode, AddressHI, AddressLO, ValueHI, ValueLO, CRCLO, CRCHI]
        if (response.length !== 8) {
            throw new Error(`WriteSingleRegister: Invalid response length. Expected 8, got ${response.length}`);
        }

        for (let i = 0; i < 6; i++) { // Compare first 6 bytes (SlaveID to ValueLO)
            if (request[i] !== response[i]) {
                throw new Error(
                    `WriteSingleRegister: Response mismatch. Request: [${request.slice(0,6).join(',')}] Response: [${response.slice(0,6).join(',')}]`
                );
            }
        }
        TRACE_INFO("mbrtu", `writeSingleRegister successful to slave ${slaveId}, address ${address}, value ${value}`);
        return true;
    }


    /**
     * Writes multiple coils to a Modbus slave device (Function Code 0x0F).
     * @param {number} slaveId - The ID of the slave device.
     * @param {number} address - The starting address of the coils to write (0x0000 to 0xFFFF).
     * @param {Array<boolean|number>} values - An array of boolean or numeric (0 or 1) values to write.
     * @returns {Promise<boolean>} A promise that resolves to true if the write was successful.
     * @throws {Error} If the write operation fails, inputs are invalid, or a Modbus exception occurs.
     */
    async writeMultipleCoils(slaveId, address, values) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error('Invalid values: Must be a non-empty array.');
        }
        const quantity = values.length;
        if (quantity < 1 || quantity > 1968) { // Max 1968 coils (0x07B0) => 246 data bytes
            throw new Error(`Invalid quantity of coils: ${quantity}. Must be between 1 and 1968.`);
        }
        if (address < 0 || address > 0xFFFF) {
            throw new Error(`Invalid coil address: ${address}. Must be between 0x0000 and 0xFFFF.`);
        }
        if ((address + quantity -1) > 0xFFFF) {
            throw new Error(`Invalid address range: Start address ${address} + quantity ${quantity} exceeds 0xFFFF.`);
        }

        const byteCount = Math.ceil(quantity / 8);
        const coilBytes = new Uint8Array(byteCount);
        for (let i = 0; i < quantity; i++) {
            if (values[i]) { // true or 1
                coilBytes[Math.floor(i / 8)] |= (1 << (i % 8));
            }
        }

        const request = this._buildWriteMultipleCoilsRequest(slaveId, address, quantity, byteCount, coilBytes);
        TRACE_VERBOSE("mbrtu", "Send writeMultipleCoils request", request);
        await this.sendRequest(request);

        // Expected response for Write Multiple Coils: [SlaveID, FuncCode, StartAddrHI, StartAddrLO, QuantityHI, QuantityLO, CRC_LO, CRC_HI] (8 bytes)
        const expectedAduResponseLength = 8;
        const response = await this._receiveResponse(slaveId, ModbusRTUMaster.FUNCTION_CODES.WRITE_MULTIPLE_COILS, expectedAduResponseLength);

        if (response.length !== 8) {
            throw new Error(`WriteMultipleCoils: Invalid response length. Expected 8, got ${response.length}`);
        }

        const responseAddress = (response[2] << 8) | response[3];
        const responseQuantity = (response[4] << 8) | response[5];

        if (responseAddress !== address) {
            throw new Error(`WriteMultipleCoils: Response address mismatch. Sent ${address}, received ${responseAddress}.`);
        }
        if (responseQuantity !== quantity) {
            throw new Error(`WriteMultipleCoils: Response quantity mismatch. Sent ${quantity}, received ${responseQuantity}.`);
        }

        TRACE_INFO("mbrtu", `writeMultipleCoils successful to slave ${slaveId}, address ${address}, quantity ${quantity}`);
        return true;
    }
    
    /**
     * @private
     * Builds a Modbus request frame for Write Multiple Registers operation.
     * @param {number} slaveId - The slave ID.
     * @param {number} address - The starting register address.
     * @param {number} quantity - The quantity of registers to write.
     * @param {number} byteCount - The number of bytes of register data (quantity * 2).
     * @param {Uint8Array} registerBytesData - The register data bytes (each register as 2 bytes, H L).
     * @returns {Uint8Array} The request frame.
     */
    _buildWriteMultipleRegistersRequest(slaveId, address, quantity, byteCount, registerBytesData) {
        const requestPdu = new Uint8Array(6 + byteCount); // FC (1) + Address (2) + Quantity (2) + ByteCount (1) + RegisterBytes (byteCount)
        requestPdu[0] = ModbusRTUMaster.FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS;
        requestPdu[1] = (address >> 8) & 0xFF;
        requestPdu[2] = address & 0xFF;
        requestPdu[3] = (quantity >> 8) & 0xFF;
        requestPdu[4] = quantity & 0xFF;
        requestPdu[5] = byteCount;
        requestPdu.set(registerBytesData, 6);

        const requestAdu = new Uint8Array(1 + requestPdu.length + 2); // SlaveID + PDU + CRC
        requestAdu[0] = slaveId;
        requestAdu.set(requestPdu, 1);
        
        const crc = this.calculateCRC(requestAdu.subarray(0, 1 + requestPdu.length));
        requestAdu[1 + requestPdu.length] = crc & 0xFF;
        requestAdu[1 + requestPdu.length + 1] = (crc >> 8) & 0xFF;
        return requestAdu;
    }

    /**
     * Writes multiple registers to a Modbus slave device (Function Code 0x10).
     * @param {number} slaveId - The ID of the slave device.
     * @param {number} address - The starting address of the registers to write (0x0000 to 0xFFFF).
     * @param {Array<number>} values - An array of 16-bit integer values to write.
     * @returns {Promise<boolean>} A promise that resolves to true if the write was successful.
     * @throws {Error} If the write operation fails, inputs are invalid, or a Modbus exception occurs.
     */
    async writeMultipleRegisters(slaveId, address, values) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error('Invalid values: Must be a non-empty array.');
        }
        const quantity = values.length;
        if (quantity < 1 || quantity > 123) { // Max 123 registers (0x007B) => 246 data bytes
            throw new Error(`Invalid quantity of registers: ${quantity}. Must be between 1 and 123.`);
        }
        if (address < 0 || address > 0xFFFF) {
            throw new Error(`Invalid register address: ${address}. Must be between 0x0000 and 0xFFFF.`);
        }
        if ((address + quantity - 1) > 0xFFFF) {
            throw new Error(`Invalid address range: Start address ${address} + quantity ${quantity} exceeds 0xFFFF.`);
        }

        const byteCount = quantity * 2;
        const registerBytesData = new Uint8Array(byteCount);
        for (let i = 0; i < quantity; i++) {
            const val = values[i];
            if (val < 0 || val > 0xFFFF) {
                throw new Error(`Invalid register value at index ${i}: ${val}. Must be between 0 and 65535.`);
            }
            registerBytesData[i * 2] = (val >> 8) & 0xFF; // High byte
            registerBytesData[i * 2 + 1] = val & 0xFF;    // Low byte
        }

        const request = this._buildWriteMultipleRegistersRequest(slaveId, address, quantity, byteCount, registerBytesData);
        TRACE_VERBOSE("mbrtu", "Send writeMultipleRegisters request", request);
        await this.sendRequest(request);

        // Expected response for Write Multiple Registers: [SlaveID, FuncCode, StartAddrHI, StartAddrLO, QuantityHI, QuantityLO, CRC_LO, CRC_HI] (8 bytes)
        const expectedAduResponseLength = 8;
        const response = await this._receiveResponse(slaveId, ModbusRTUMaster.FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS, expectedAduResponseLength);

        if (response.length !== 8) {
            throw new Error(`WriteMultipleRegisters: Invalid response length. Expected 8, got ${response.length}`);
        }

        const responseAddress = (response[2] << 8) | response[3];
        const responseQuantity = (response[4] << 8) | response[5];

        if (responseAddress !== address) {
            throw new Error(`WriteMultipleRegisters: Response address mismatch. Sent ${address}, received ${responseAddress}.`);
        }
        if (responseQuantity !== quantity) {
            throw new Error(`WriteMultipleRegisters: Response quantity mismatch. Sent ${quantity}, received ${responseQuantity}.`);
        }
        
        TRACE_INFO("mbrtu", `writeMultipleRegisters successful to slave ${slaveId}, address ${address}, quantity ${quantity}`);
        return true;
    }

    parseRegisterValues(response, quantity) {
        const values = [];
        for (let i = 0; i < quantity; i++) {
            const value = (response[3 + i * 2] << 8) | response[4 + i * 2];
            values.push(value);
        }
        return values;
    }

    parseCoilValues(response, quantity) {
        const values = [];
        for (let i = 0; i < quantity; i++) {
            const byteIndex = 3 + Math.floor(i / 8);
            const bitIndex = i % 8;
            const value = (response[byteIndex] & (1 << bitIndex)) !== 0 ? 1 : 0;
            values.push(value);
        }
        return values;
    }
}
