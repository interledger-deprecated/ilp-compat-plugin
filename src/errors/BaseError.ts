/**
 * Extensible error class.
 *
 * The built-in Error class is not actually a constructor, but a factory. It
 * doesn't operate on `this`, so if we call it as `super()` it doesn't do
 * anything useful.
 *
 * Nonetheless it does create objects that are instanceof Error. In order to
 * easily subclass error we need our own base class which mimics that behavior
 * but with a true constructor.
 *
 * Note that this code is specific to V8 (due to `Error.captureStackTrace`).
 */
export default class BaseError extends Error {
  constructor (message?: string) {
    super()
    Object.setPrototypeOf(this, BaseError)

    // Set this.message
    Object.defineProperty(this, 'message', {
      configurable: true,
      enumerable: false,
      value: message !== undefined ? String(message) : ''
    })

    // Set this.stack
    Error.captureStackTrace(this, this.constructor)
  }
}
