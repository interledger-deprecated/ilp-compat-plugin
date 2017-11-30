'use strict'

const BaseError = require('./BaseError')

class TransferHandlerAlreadyRegisteredError extends BaseError {
}

module.exports = TransferHandlerAlreadyRegisteredError
