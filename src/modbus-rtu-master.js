class ModbusRTUMaster {
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
        const response = await this.readRegisters(slaveId, 0x03, startAddress, quantity);
        return this.parseRegisterValues(response, quantity);
    }

    async readInputRegisters(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, 0x04, startAddress, quantity);
        return this.parseRegisterValues(response, quantity);
    }

    async readCoils(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, 0x01, startAddress, quantity);
        return this.parseCoilValues(response, quantity);
    }

    async readDiscreteInputs(slaveId, startAddress, quantity) {
        const response = await this.readRegisters(slaveId, 0x02, startAddress, quantity);
        return this.parseCoilValues(response, quantity);
    }

    async readRegisters(slaveId, functionCode, startAddress, quantity) {
        const frameLength = 8; // 8 bytes for reading (slave ID, function code, start address, quantity, CRC)
        if (frameLength > 250) {
            throw new Error('Read frame length exceeded: frame too long.');
        }

        const request = this.buildRequest(slaveId, functionCode, startAddress, quantity);
        TRACE_VERBOSE("mbrtu", "Send request");
        await this.sendRequest(request);
        return await this.receiveResponse(slaveId, functionCode, quantity);
    }

    buildRequest(slaveId, functionCode, address, quantity) {
        const request = new Uint8Array(8);
        request[0] = slaveId;
        request[1] = functionCode;
        request[2] = (address >> 8) & 0xFF;
        request[3] = address & 0xFF;
        request[4] = (quantity >> 8) & 0xFF;
        request[5] = quantity & 0xFF;
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

    async receiveResponse(slaveId, functionCode, quantity) {
        let expectedLength = 5 + quantity * 2;
        let response = new Uint8Array(expectedLength);
        let index = 0;

        try {
            await Promise.race([
                (async () => {
                    while (index < expectedLength) {
                        const { value, done } = await this.reader.read();
                        if (done) throw new Error('Device has been lost');
                        response.set(value, index);
                        index += value.length;

                        if (index >= 2 && (response[1] & 0x80)) {
                            expectedLength = 5;
                        }
                    }
                })(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout: No response received within the time limit.')), this.timeout)
                )
            ]);

            if (response[1] & 0x80) {
                const exceptionCode = response[2];
                throw new Error(`Modbus Exception Code: ${this.getExceptionMessage(exceptionCode)} (Code: ${exceptionCode})`);
            }

            const dataWithoutCRC = response.slice(0, index - 2);
            const receivedCRC = (response[index - 1] << 8) | response[index - 2];
            const calculatedCRC = this.calculateCRC(dataWithoutCRC);

            if (calculatedCRC === receivedCRC) {
                TRACE_VERBOSE("mbrtu", 'Received response with valid CRC:', response.slice(0, index));
                return response.slice(0, index);
            } else {
                throw new Error(`CRC Error: Calculated CRC ${calculatedCRC} does not match received CRC ${receivedCRC}.`);
            }
        } catch (error) {
            TRACE_ERROR("mbrtu", 'Error receiving response:', error.message);
            if (this.reader) {
                await this.reader.cancel();
                await this.reader.releaseLock();
                this.reader = null;
                this.reader = this.port.readable.getReader();
            }
            if (error.message.includes('Device has been lost')) {
                await this.handleDeviceLost();
            }
            throw error;
        }
    }

    getExceptionMessage(code) {
        const exceptionMessages = {
            1: 'Illegal Function',
            2: 'Illegal Data Address',
            3: 'Illegal Data Value',
            4: 'Slave Device Failure',
            5: 'Acknowledge',
            6: 'Slave Device Busy',
            8: 'Memory Parity Error',
            10: 'Gateway Path Unavailable',
            11: 'Gateway Target Device Failed to Respond'
        };
        return exceptionMessages[code] || 'Unknown Error';
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
