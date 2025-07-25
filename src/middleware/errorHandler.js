const ErrorHandlingService = require('../services/errorHandlingService');

// Create singleton instance
const errorHandlingService = new ErrorHandlingService();

// Export the express middleware
module.exports = errorHandlingService.expressErrorHandler();