var logger = require('loglevel')
var ngOpbeat = require('./ngOpbeat')
var TransactionService = require('../transaction/transaction_service')

function ServiceContainer (config) {
  this.services = { logger: logger }
  logger.setLevel(config.logLevel, false)
  var transactionService = this.services.transactionService = new TransactionService(logger, {})
  // todo: remove this when updating to new version of zone.js
  function noop () { }
  var _warn = console.warn
  console.warn = noop

  if (typeof window.zone === 'undefined') {
    require('zone.js')
  }

  var zonePrototype = ('getPrototypeOf' in Object)
    ? Object.getPrototypeOf(window.zone) : window.zone.__proto__ // eslint-disable-line 

  zonePrototype.enqueueTask = noop
  zonePrototype.dequeueTask = noop
  console.warn = _warn

  var ZoneService = require('../transaction/zone_service')
  var zoneService = this.services.zoneService = new ZoneService(window.zone, transactionService, logger)

  // binding bootstrap to zone

  window.angular.bootstrap = zoneService.zone.bind(window.angular.bootstrap)

  window.name = 'NG_DEFER_BOOTSTRAP!' + window.name
  window.angular.resumeDeferredBootstrap = function () {
    var resumeBootstrap = zoneService.zone.bind(window.angular.resumeBootstrap)
    resumeBootstrap()
  }

  ngOpbeat(transactionService, logger)
}

module.exports = ServiceContainer
