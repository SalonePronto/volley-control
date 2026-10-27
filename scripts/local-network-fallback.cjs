// Development-only compatibility for sandboxes where Node cannot enumerate
// network interfaces. Does not change listeners, outbound traffic or the Worker.
const os = require('node:os');
const original = os.networkInterfaces;
os.networkInterfaces = function () {
  try {
    return original();
  } catch (error) {
    if (error.code === 'ERR_SYSTEM_ERROR') return {};
    throw error;
  }
};
