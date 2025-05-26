# Modbus-RTU-Master

> [!NOTE]
> The library now uses my https://github.com/Pablo2048/trace.js javascript library for debugging output.

Implementation of a Modbus RTU master device in JavaScript, usable in web applications in Chrome and Firefox browsers.

The module was primarily written for web applications used by my beloved wife and serves for commissioning and testing devices at our workplace. The library implements all standard Modbus read functions (Read Coils, Read Discrete Inputs, Read Holding Registers, Read Input Registers) and common write functions (Write Single Coil, Write Single Register, Write Multiple Coils, Write Multiple Registers). While all functions aim for specification compliance, active testing has been primarily focused on holding and input registers for reads, and now on coils and holding registers for writes.

The repository also includes a simple usage example that allows setting communication parameters and periodically reads one register every 5 seconds, displaying it on the web page (please excuse the Czech comments in the source code).

## Supported Operations

This section details the Modbus functions implemented by the library. All methods are asynchronous and return a Promise.

### Read Operations

These methods allow reading data from a Modbus slave device.

*   **`readCoils(slaveId, startAddress, quantity)`**: Reads a sequence of coils (digital ON/OFF states).
*   **`readDiscreteInputs(slaveId, startAddress, quantity)`**: Reads a sequence of discrete inputs (digital ON/OFF states, typically read-only).
*   **`readHoldingRegisters(slaveId, startAddress, quantity)`**: Reads a sequence of holding registers (16-bit analog/data values).
*   **`readInputRegisters(slaveId, startAddress, quantity)`**: Reads a sequence of input registers (16-bit analog/data values, typically read-only).

For detailed parameters and return values (typically `Promise<Array<number|boolean>>`), please refer to the JSDoc comments within the source code.

### Write Operations

These methods allow writing data to a Modbus slave device.

#### `writeSingleCoil(slaveId, address, value)`

*   **Description**: Writes a single coil (digital ON/OFF state) to a Modbus slave device.
*   **Parameters**:
    *   `slaveId (number)`: The Modbus slave ID (typically 1-247).
    *   `address (number)`: The coil address to write to (0x0000 - 0xFFFF).
    *   `value (boolean)`: The value to write. `true` for ON (writes 0xFF00), `false` for OFF (writes 0x0000).
*   **Returns**: `Promise<boolean>` - Resolves to `true` if the operation was successful and validated by the slave. Rejects with an error on failure (e.g., Modbus exception, CRC error, timeout, response mismatch).
*   **JavaScript Usage Example**:
    ```javascript
    async function exampleWriteSingleCoil(modbusMaster, slaveId, coilAddress, coilValue) {
        try {
            const success = await modbusMaster.writeSingleCoil(slaveId, coilAddress, coilValue);
            if (success) {
                console.log(`Successfully wrote coil at address ${coilAddress} to ${coilValue ? 'ON' : 'OFF'}.`);
            }
        } catch (error) {
            console.error(`Failed to write single coil at address ${coilAddress}:`, error);
        }
    }
    // await exampleWriteSingleCoil(modbusMaster, 1, 100, true); 
    ```

#### `writeSingleRegister(slaveId, address, value)`

*   **Description**: Writes a single holding register (16-bit value) to a Modbus slave device.
*   **Parameters**:
    *   `slaveId (number)`: The Modbus slave ID (typically 1-247).
    *   `address (number)`: The register address to write to (0x0000 - 0xFFFF).
    *   `value (number)`: The 16-bit integer value to write (0 - 65535).
*   **Returns**: `Promise<boolean>` - Resolves to `true` if the operation was successful and validated by the slave. Rejects with an error on failure.
*   **JavaScript Usage Example**:
    ```javascript
    async function exampleWriteSingleRegister(modbusMaster, slaveId, regAddress, regValue) {
        try {
            const success = await modbusMaster.writeSingleRegister(slaveId, regAddress, regValue);
            if (success) {
                console.log(`Successfully wrote register at address ${regAddress} with value ${regValue}.`);
            }
        } catch (error) {
            console.error(`Failed to write single register at address ${regAddress}:`, error);
        }
    }
    // await exampleWriteSingleRegister(modbusMaster, 1, 200, 12345);
    ```

#### `writeMultipleCoils(slaveId, address, values)`

*   **Description**: Writes a sequence of coils (digital ON/OFF states) to a Modbus slave device.
*   **Parameters**:
    *   `slaveId (number)`: The Modbus slave ID (typically 1-247).
    *   `address (number)`: The starting address of the coils to write (0x0000 - 0xFFFF).
    *   `values (Array<boolean|number>)`: An array of boolean or numeric (0 or 1) values to write. The number of coils (quantity) must be between 1 and 1968.
*   **Returns**: `Promise<boolean>` - Resolves to `true` if the operation was successful and validated by the slave. Rejects with an error on failure.
*   **JavaScript Usage Example**:
    ```javascript
    async function exampleWriteMultipleCoils(modbusMaster, slaveId, startAddress, coilValues) {
        try {
            const success = await modbusMaster.writeMultipleCoils(slaveId, startAddress, coilValues);
            if (success) {
                console.log(`Successfully wrote ${coilValues.length} coils starting at address ${startAddress}.`);
            }
        } catch (error) {
            console.error(`Failed to write multiple coils starting at address ${startAddress}:`, error);
        }
    }
    // await exampleWriteMultipleCoils(modbusMaster, 1, 300, [true, false, true, true, false]);
    ```

#### `writeMultipleRegisters(slaveId, address, values)`

*   **Description**: Writes a sequence of holding registers (16-bit values) to a Modbus slave device.
*   **Parameters**:
    *   `slaveId (number)`: The Modbus slave ID (typically 1-247).
    *   `address (number)`: The starting address of the registers to write (0x0000 - 0xFFFF).
    *   `values (Array<number>)`: An array of 16-bit integer values (0 - 65535) to write. The number of registers (quantity) must be between 1 and 123.
*   **Returns**: `Promise<boolean>` - Resolves to `true` if the operation was successful and validated by the slave. Rejects with an error on failure.
*   **JavaScript Usage Example**:
    ```javascript
    async function exampleWriteMultipleRegisters(modbusMaster, slaveId, startAddress, registerValues) {
        try {
            const success = await modbusMaster.writeMultipleRegisters(slaveId, startAddress, registerValues);
            if (success) {
                console.log(`Successfully wrote ${registerValues.length} registers starting at address ${startAddress}.`);
            }
        } catch (error) {
            console.error(`Failed to write multiple registers starting at address ${startAddress}:`, error);
        }
    }
    // await exampleWriteMultipleRegisters(modbusMaster, 1, 400, [100, 200, 300, 400, 500]);
    ```

### Developer Notes

#### Function Codes
The `ModbusRTUMaster` class exposes a static property `ModbusRTUMaster.FUNCTION_CODES`. This object maps human-readable Modbus function names (e.g., `READ_COILS`, `WRITE_SINGLE_REGISTER`) to their respective numerical function codes (e.g., `0x01`, `0x06`). This can be useful for debugging, understanding the underlying protocol, or potentially extending the library with less common Modbus functions.

Example:
```javascript
console.log(ModbusRTUMaster.FUNCTION_CODES.WRITE_MULTIPLE_COILS); // Outputs: 15 (0x0F)
```

## Usage in Firefox Browser

Unfortunately, Firefox does not natively support the WebSerial API, but luckily, you can use this plugin https://addons.mozilla.org/en-US/firefox/addon/webserial-for-firefox/ to add support. However, uploading via file:// does not work, because of Firefox policy, so you need to run practically any web server locally, for example, in Python using `python -m http.server`. The web application will then be available at http://localhost:8000, and WebSerial will function normally.
