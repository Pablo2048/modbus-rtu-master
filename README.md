# Modbus-RTU-Master

> [!NOTE]
> The library now uses my https://github.com/Pablo2048/trace.js javascript library for debugging output.

Implementation of a Modbus RTU master device in JavaScript, usable in web applications in Chrome and Firefox browsers.

The module was primarily written for web applications used by my beloved wife and serves for commissioning and testing devices at our workplace. It supports reading and writing from all Modbus areas, but only input registers and holding registers are tested/actively used. The repository also includes a simple usage example that allows setting communication parameters and periodically reads one register every 5 seconds, displaying it on the web page (please excuse the Czech comments in the source code).

# Usage in Firefox Browser

Unfortunately, Firefox does not natively support the WebSerial API, but luckily, you can use this plugin https://addons.mozilla.org/en-US/firefox/addon/webserial-for-firefox/ to add support. However, uploading via file:// does not work, because of Firefox policy, so you need to run practically any web server locally, for example, in Python using `python -m http.server`. The web application will then be available at http://localhost:8000, and WebSerial will function normally.
