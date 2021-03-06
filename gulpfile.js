/*eslint-disable */

var fs = require('fs')
var gulp = require('gulp')

var taskListing = require('gulp-task-listing')

var karma = require('karma')
var runSequence = require('run-sequence')
var webdriver = require('gulp-webdriver')
var selenium = require('selenium-standalone')
var replace = require('gulp-replace')

var webpack = require('webpack')
var afterAll = require('after-all')

var path = require('path')
var connect = require('gulp-connect')

require('gulp-release-tasks')(gulp)

var webdriverConfig = {
  user: process.env.SAUCE_USERNAME || 'opbeat-react',
  key: process.env.SAUCE_ACCESS_KEY || '699838bc-49b3-4c92-adf0-690ba855e0d6',
  host: process.env.SAUCE_HOST || 'ondemand.saucelabs.com',
  port: process.env.SAUCE_PORT || 80,
  baseUrl: process.env.SAUCE_BASEURL || 'http://localhost:8000'
}

// Static file server
gulp.task('examples:serve', function () {
  connect.server({
    root: ['examples', 'dist'],
    port: 7000,
    livereload: false,
    open: false
  })
})

function getMajorVersion () {
  var version = require('./package').version
  var majorVersion = version.match(/^(\d).(\d).(\d)/)[1]
  return majorVersion
}

gulp.task('build:e2e', function (done) {
  var dirNeedsBuilding = [
    './test/e2e/router/webpack.config.js',
    './test/e2e/router/webpack.server.config.js',
    './test/e2e/react/webpack.config.js',
    './test/e2e/redux/webpack.config.js',
    './test/e2e/no-init/webpack.config.js',
    './test/e2e/fetch/webpack.config.js'
  ]

  var left = dirNeedsBuilding.length
  var next = afterAll(done)
  dirNeedsBuilding.forEach(function (dir) {
    var buildDone = next()
    console.log('Building', dir)
    var webpackConfig = require(dir)
    webpack(webpackConfig).run(function (err, stats) {
      if (err) throw err // throw err
      if (stats.hasErrors()) console.log('!! there were errors building', dir)

      var jsonStats = stats.toJson()
      if (jsonStats.errors.length > 0) {
        jsonStats.errors.forEach(function (error) {
          console.log('Error:', error)
        })
      }

      buildDone()
    })
  })
})

gulp.task('build:release', function (done) {
  var prodPath = './dist/opbeat-react'
  var version = require('./package.json').version
  var next = afterAll(done)

  gulp.src(['src/**/*.js'])
    .pipe(replace(
      new RegExp(RegExp.escape('%%VERSION%%'), 'g'),
      'v' + version
    ))
    .pipe(gulp.dest(prodPath))
    .on('end', next())

  gulp.src(['./README.md', './package.json', './LICENSE'])
    .pipe(gulp.dest(prodPath))
    .on('end', next())
})

// Development mode
gulp.task('watch', [], function (cb) {
  gulp.run(
    'build',
    'examples:serve'
  )

  // Watch JS files
  gulp.watch(['libs/**', 'src/**'], function () { runSequence('build', 'karma-run') })
  console.log('\nExample site running on http://localhost:7000/\n')
})

function runKarma (configFile, done) {
  var exec = require('child_process').exec

  var cmd = process.platform === 'win32' ? 'node_modules\\.bin\\karma run ' :
    'node node_modules/.bin/karma run '
  cmd += configFile
  exec(cmd, function (e, stdout) {
    // ignore errors, we don't want to fail the build in the interactive (non-ci) mode
    // karma server will print all test failures
    done()
  })
}

gulp.task('karma-run', function (done) {
  // run the run command in a new process to avoid duplicate logging by both server and runner from
  // a single process
  runKarma('karma.conf.js', done)
})

gulp.task('test', function (done) {
  new karma.Server({
    configFile: __dirname + '/karma.conf.js',
    singleRun: true
  }, done).start()
})

// Run end-to-end tests on the local machine using webdriver configuration
gulp.task('test:e2e:run', function (done) {
  gulp.src('wdio.conf.js')
    .pipe(webdriver())
    .on('error', function () {
      return process.exit(1)
    })
    .on('end', function () {
      return process.exit(0)
    })
})

gulp.task('test:e2e:sauceconnect:failsafe', function () {
  var failSafeStream = gulp.src('wdio.failsafe.conf.js')
    .pipe(webdriver(webdriverConfig))
    .on('error', function () {
      console.log('Exiting process with status 1')
      process.exit(1)
    })
    .on('end', function () {
      console.log('Tests complete')
    })
  return failSafeStream
})

// Run end-to-end tests remotely in saucelabs using webdriver configuration
gulp.task('test:e2e:sauceconnect', ['test:e2e:sauceconnect:failsafe'], function () {
  var e2eStream = gulp.src('wdio.sauce.conf.js')
    .pipe(webdriver(webdriverConfig))
    .on('error', function () {
      console.log('Exiting process with status 1')
      process.exit(1)
    })
    .on('end', function () {
      console.log('Tests complete')
    })
  return e2eStream
})

// Launch sauce connect and connect
gulp.task('test:e2e:launchsauceconnect', function (done) {
  var sauceConnectLauncher = require('sauce-connect-launcher')

  var config = {
    username: webdriverConfig.user,
    accessKey: webdriverConfig.key,
    logger: console.log
  }

  var tryConnect = function (maxAttempts, currAttempts, done) {
    sauceConnectLauncher(config, function (err, sauceConnectProcess) {
      if (err) {
        console.error(err.message)
        if (currAttempts <= maxAttempts) {
          console.log('Retrying... (attempt ' + currAttempts + ' of ' + maxAttempts + ')')
          tryConnect(maxAttempts, ++currAttempts, done)
        } else {
          return process.exit(1)
        }
      } else {
        console.log('Sauce Connect ready')
        done()
      }
    })
  }

  tryConnect(3, 1, done)
})

// Serve test application
gulp.task('test:e2e:serve', function () {
  return connect.server({
    root: ['test/e2e', 'src', './'],
    port: 8000,
    livereload: false,
    open: false,
    middleware: function (connect, opt) {
      var middlewares = []
      middlewares.push(connect.favicon())

      // used to test truncated XHR traces
      middlewares.push(function (request, response, next) {
        if (request.url == '/slow-response') {
          setTimeout(function () { response.write('Slow!'); response.end()}, 5000)
        }else {
          next()
        }
      })

      return middlewares
    }
  })
})

gulp.task('test:e2e:run-ssr', function () {
  var childProcess = require('child_process')
  var path = require('path')
  var cp = childProcess.fork(path.join(__dirname, 'test/e2e/router/server.bundle.js'))
  cp.on('exit', function (code, signal) {
    console.log('Exited', {code: code, signal: signal})
  })
  cp.on('error', console.error.bind(console))
})

function onExit (callback) {
  function exitHandler (err) {
    try {
      callback(err)
    }
    finally {
      if (err) console.log(err.stack)
    }
  }

  process.on('exit', exitHandler)

  process.on('SIGINT', exitHandler)

  process.on('uncaughtException', exitHandler)
}

function startSelenium (callback, manualStop) {
  selenium.install({ logger: console.log }, function (installError) {
    if (installError) {
      console.log('Error while installing selenium:', installError)
    }
    selenium.start(function (startError, child) {
      if (startError) {
        console.log('Error while starting selenium:', startError)
        return process.exit(1)
      } else {
        console.log('Selenium started!')
        function killSelenium () {
          child.kill()
          console.log('Just killed selenium!')
        }
        if (manualStop) {
          callback(killSelenium)
        }else {
          onExit(killSelenium)
          callback()
        }
      }
    })
  })
}

// Install and start selenium
gulp.task('test:e2e:selenium', function (done) {
  startSelenium(function () {
    done()
  })
})

gulp.task('test:e2e:start-local', ['test:e2e:serve', 'test:e2e:selenium', 'test:e2e:run-ssr'])
gulp.task('test:e2e:react-run', function (done) {
  runSequence('build:release', 'build:e2e', 'test:e2e:start-local', 'test:e2e:run', function (err) {
    if (err) {
      return taskFailed(err)
    } else {
      return sequenceSucceeded(done)
    }
  })
})

// Run all required tasks to perform remote end-to-end testing
gulp.task('test:e2e:start-sauce', function (done) {
  runSequence('build:release', 'test:e2e:launchsauceconnect', function () {
    console.log('All tasks completed.')
  })
})

gulp.task('test:e2e', function (done) {
  runSequence('build:e2e', ['build:release', 'test:e2e:start-local'], ['test:e2e:launchsauceconnect'], 'test:e2e:sauceconnect', function (err) {
    if (err) {
      return taskFailed(err)
    } else {
      return sequenceSucceeded(done)
    }
  })
})

function taskFailed (err) {
  var exitCode = 2
  console.log('[ERROR] gulp build task failed', err)
  console.log('[FAIL] gulp build task failed - exiting with code ' + exitCode)
  return process.exit(exitCode)
}

function sequenceSucceeded (done) {
  console.log('All tasks completed.')
  done()
  return process.exit(0)
}

gulp.task('test:unit:sauce', function (done) {
  runSequence(['build:release', 'test:e2e:launchsauceconnect'], 'test', function (err) {
    if (err) {
      return taskFailed(err)
    } else {
      return sequenceSucceeded(done)
    }
  })
})

gulp.task('watch:e2e', ['e2e-serve', 'selenium-start'], function (done) {
  gulp.watch(['test/e2e/**'], function () {
    runSequence('test:e2e')
  })
})

gulp.task('default', taskListing)
