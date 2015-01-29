var p2World
var pixi = PIXI
var stage
var pixiWorld
var renderer
var lastRender
var lastSave = Date.now()
var bodyMap = {}
var player = {}
var isHost = false
var interpolationBuffer = []
var framesToInterpolate = 0
var timeDiffs = []
var avgTimeDiff = 0
var inputIndex = 0
var inputBuffer = []
var cpuScore

var update = simpleUpdate
var handleInput = simpleHandleInput

Meteor.startup(function () {
  if (!localStorage.uuid) localStorage.uuid = Meteor.uuid()
  Meteor.loginWithPassword({ username: localStorage.uuid }, Config.defaultPassword, function (er) {
    if (!er) loggedIn()
    else if (er.error === 403) {
      console.log('Creating new user')
      Accounts.createUser({
        username: localStorage.uuid,
        password: Config.defaultPassword
      }, function (er) {
        loggedIn()
      })
    } else console.error(er)
  })

  var keepAlive = Meteor.setInterval(function () {
    var thisPlayer = Players.findOne({ username: localStorage.uuid })
    if (thisPlayer) Players.update(thisPlayer._id, { $set: { lastSeen: Date.now() } })
  }, 1000)
})

Template.game.helpers({
  players: function () {
    return Players.find()
  },
  isHost: function () {
    return Hosts.findOne({ username: localStorage.uuid })
  }
});

Template.game.rendered = function () {
  cpuTest(function (score) {
    console.log('CPU score is', score)
    var dbPlayer = Players.findOne({ username: localStorage.uuid })
    if (dbPlayer) Players.update(dbPlayer._id, { $set: { cpuScore: score } })

    Meteor.subscribe('Bodies', {
      onReady: function () {
        initPhysics()
        initRender()
        update()
      }
    })

    InputStream.on('Input', function (event) {
      if (isHost) handleInput(event.position, event.worldId)
    })

    SnapshotStream.on('Snapshot', function (snapshot) {
      processSnapshot(snapshot)
    })

    $(document).on('mousedown touchstart', function (e) {
      if (e.type === 'mousedown') var clickPosition = [e.pageX, window.innerHeight - e.pageY]
      else if (e.type === 'touchstart') var clickPosition = [e.originalEvent.touches[0].pageX, window.innerHeight - e.originalEvent.touches[0].pageY]

      if (isHost || update === clientSidePredictionUpdate) handleInput(clickPosition, player.body.id)
      if (!isHost || update === clientSidePredictionUpdate) {
        InputStream.emit('Input', {
          position: clickPosition,
          worldId: player.body.id,
          index: inputIndex
        })
        inputBuffer.push({
          position: clickPosition,
          index: inputIndex
        })
        inputIndex++
      }
    })

    Meteor.subscribe('ModeSwitches', {
      onReady: function () {
        ModeSwitches.find().observe({
          added: function (mode) {
            if (mode.name === 'simple') update = simpleUpdate
            if (mode.name === 'simpleInterpolate') update = simpleInterpolatedSnapshotsUpdate
          }
        })
      }
    })
  })
}

function simpleUpdate (time) {
  var deltaTime = (time - lastRender) / 1000
  lastRender = time
  if (isHost) {
    var bodies = p2World.bodies.map(function (body) {
      return {
        id: body.id,
        position: body.position
      }
    })
    SnapshotStream.emit('Snapshot', { bodies: bodies })
    p2World.step(deltaTime || 0.017)
    if (Date.now() - lastSave > 5000) saveState()
  } else {
    var snapshot = interpolationBuffer[interpolationBuffer.length - 1]
    if (snapshot) {
      snapshot.bodies.forEach(function (body) {
        var p2Body = p2World.getBodyById(body.id)
        p2Body.position = body.position
      })
      interpolationBuffer = []
    }
  }
  renderBodies()
  renderer.render(stage)
  requestAnimationFrame(update)
}

function simpleInterpolatedSnapshotsUpdate (time) {
  var deltaTime = (time - lastRender) / 1000
  lastRender = time
  if (isHost) {
    if (interpolationBuffer.length === 0 || Date.now() - interpolationBuffer[0].time > 1000 / Config.interpolation.pps) {
      var bodies = p2World.bodies.map(function (body) {
        return {
          id: body.id,
          position: body.position
        }
      })
      var snapshot = { bodies: bodies, time: Date.now() }
      SnapshotStream.emit('Snapshot', snapshot)
      interpolationBuffer = [snapshot]
    }
    p2World.step(deltaTime || 0.017)
    if (Date.now() - lastSave > 5000) saveState()
  } else {
    if (avgTimeDiffInterval === undefined) {
      var avgTimeDiffInterval = Meteor.setInterval(function () {
        if (timeDiffs.length === 0) return
        var sum = timeDiffs.reduce(function (a, b) { return a + b })
        var avgTimeDiff = sum / timeDiffs.length
        timeDiffs = []
      }, 5000)
    }
    if (interpolationBuffer.length > 1) {
      if (framesToInterpolate < 1) framesToInterpolate = 60 / Config.interpolation.pps
      interpolatePositions(interpolationBuffer[interpolationBuffer.length - 1], framesToInterpolate)
      framesToInterpolate--
    }
  }
  renderBodies()
  renderer.render(stage)
  requestAnimationFrame(update)
}

function clientSidePredictionUpdate (time) {
  var deltaTime = (time - lastRender) / 1000
  lastRender = time
  renderBodies()
  renderer.render(stage)
  requestAnimationFrame(update)
}

function processSnapshot (snapshot) {
  if (snapshot.time) timeDiffs.push(Date.now() - snapshot.time)
  interpolationBuffer.push(snapshot)
}

function interpolatePositions (endSnapshot, remainingInterpolatedFrames) {
  endSnapshot.bodies.forEach(function (body) {
    var p2Body = p2World.getBodyById(body.id)
    if (!p2Body) return
    var interpolationVector = [
      (body.position[0] - p2Body.position[0]) / remainingInterpolatedFrames,
      (body.position[1] - p2Body.position[1]) / remainingInterpolatedFrames
    ]
    p2Body.position[0] += interpolationVector[0]
    p2Body.position[1] += interpolationVector[1]
  })
}

function renderBodies () {
  Object.getOwnPropertyNames(bodyMap).forEach(function (key) {
    var o = bodyMap[key]
    if (!o.graphic && o.body) startRenderingBody(o.body)
    else {
      o.graphic.position.x = o.body.position[0]
      o.graphic.position.y = o.body.position[1]
      o.graphic.rotation = o.body.angle
    }
  })
}

function loggedIn () {
  console.log('Logged in with username', Meteor.user().username)

  Meteor.subscribe('Players', {
    onReady: function () {
      Players.find().forEach(createPlayerBody)
    }
  })

  Meteor.subscribe('Hosts', {
    onReady: function () {
      Hosts.find().observe({
        added: function (host) {
          switchHost(host)
        }
      })
    }
  })
}

function switchHost (host) {
  console.log('New host:', host.username)
  if (host.username === localStorage.uuid) becomeHost()
  else becomeClient()
}

function becomeHost () {
  if (isHost) return console.warn('becomeHost() was called but I am already the host')
  isHost = true
  console.log('Becoming host')
  // Do host stuff
}

function becomeClient () {
  if (!isHost) return // We're already a client, and shouldn't need to do anything
  isHost = false
  console.log('Becoming a client')
  // Do client stuff
}

function simpleHandleInput (position, playerWorldId) {
  var playerBody = p2World.getBodyById(playerWorldId)
  if (!playerBody) return
  var positionVector = [
     position[0] - playerBody.position[0],
     position[1] - playerBody.position[1],
  ]
  var forceVector = normalizeVector(positionVector)
  playerBody.applyForce(forceVector, playerBody.position)
}

function normalizeVector (v) {
  var length = Math.sqrt((v[0] * v[0]) + (v[1] * v[1]))
  v[0] /= length
  v[1] /= length
  v[0] *= 10000
  v[1] *= 10000
  return v
}

function initPhysics () {
  p2World = new p2.World({
    gravity: Config.world.gravity
  })
  Bodies.find().forEach(function (body) {
    startSimulatingBody(body)
  })
  Bodies.find().observe({
    added: function (body) {
      startSimulatingBody(body)
    },
    removed: function (body) {
      console.log(body)
      stopSimulatingBody(body)
    }
  })
  Players.find().observe({
    added: function (player) {
      if (!isHost) return
      createPlayerBody(player)
    }
  })
}

function createPlayerBody (player) {
  if (Bodies.find({ 'data.username': player.username }).count() === 0) {
    Bodies.insert({
      worldId: Bodies.find().count() + 1,
      position: [Math.random() * 200, 200],
      shape: {
        type: 'circle',
        radius: 10
      },
      mass: 5,
      damping: 0.6,
      data: {
        username: player.username
      }
    })
  }
}

function startSimulatingBody (document) {
  var existingBodies = p2World.bodies.filter(function (body) {
    if (body.id === document.worldId) {
      return body
    }
  })
  if (existingBodies.length) return null
  var p2Body = new p2.Body({
    position: document.position || [0, 0],
    mass: document.mass || 1,
    damping: document.damping || 0.1
  })
  p2Body.id = document.worldId
  p2Body.data = document.data
  if (document.shape.type === 'circle') {
    var p2Shape = new p2.Circle(document.shape.radius)
    p2Body.addShape(p2Shape)
  }
  p2Body.velocity = document.velocity !== undefined ? document.velocity : [0, 0]
  console.log('Started simulating body:', p2Body)
  p2World.addBody(p2Body)
  if (!bodyMap[document.worldId]) bodyMap[document.worldId] = { body: p2Body }
  else bodyMap[document.worldId].body = p2Body
  if (document.data && Meteor.user() && document.data.username === Meteor.user().username) {
    console.log('Player body is:', p2Body)
    player.body = p2Body
  }
}

function stopSimulatingBody (body) {
  console.log('Stopped simulating:', body)
  p2World.removeBody(p2World.getBodyById(body.worldId))
  pixiWorld.children.filter(function (graphic) {
    if (graphic.worldId = body.worldId) pixiWorld.removeChild(graphic)
  })
}

function initRender () {
  stage = new pixi.Stage(0x000000)
  // We add physics objects to the world, then move the "camera" by changing the world's position
  pixiWorld = new pixi.DisplayObjectContainer()
  ui = new pixi.DisplayObjectContainer()
  stage.addChild(pixiWorld)
  // The UI should be static tho
  stage.addChild(ui)
  initialScreenRatio = window.innerWidth / window.innerHeight
  renderer = new pixi.autoDetectRenderer(window.innerWidth - 4, window.innerHeight - 4, {
    antialias: true
  })
  document.body.appendChild(renderer.view)
}

function startRenderingBody (body) {
  var pixiShape
  if (body.shapes[0].type === p2.Shape.CIRCLE) pixiShape = new pixi.Circle(0, 0, body.shapes[0].radius)
  else if (body.shapes[0].type === p2.Shape.RECTANGLE) pixiShape = new pixi.Rectangle(-body.shapes[0].width / 2, -body.shapes[0].height / 2, body.shapes[0].width, body.shapes[0].height)
  else {
    console.warn('The heck is this:', body.shapes[0])
    return null
  }

  var graphic = new pixi.Graphics()
  if (body.data && Meteor.user() && body.data.username === Meteor.user().username) graphic.beginFill(0xFFFF00)
  else graphic.beginFill(0xFFFFFF)

  graphic.drawShape(pixiShape)
  graphic.endFill()
  graphic.position = {
    x: body.position[0],
    y: body.position[1]
  }
  if (body.data && Meteor.user() && body.data.username === Meteor.user().username) player.graphic = graphic
  console.log('Started rendering body:', graphic)
  pixiWorld.addChild(graphic)
  if (!bodyMap[body.id]) bodyMap[body.id] = { graphic: graphic }
  else bodyMap[body.id].graphic = graphic
}

function saveState () {
  console.log('Saving state')
  Bodies.find().forEach(function (body) {
    var p2Body = p2World.getBodyById(body.worldId)
    if (!p2Body) Bodies.remove(body._id)
    else {
      Bodies.update(body._id, {
        $set: {
          position: p2Body.position,
          velocity: p2Body.velocity
        }
      })
    }
  })
  lastSave = Date.now()
}

function cpuTest (cb) {
  console.log('performing cpu test')
  var stepCount = 0
  var stop = false
  var testWorld = new p2.World({
    gravity: [0, -9.78]
  })
  for (var i=0; i++; i < 50) {
    var testBody = new p2.Body({
      position: [ i * 10, 10 ],
      mass: i,
      damping: 0.1
    })
    var testShape = new p2.Circle(4)
    testBody.addShape(testShape)
    testBody.velocity = [ 25 - i, i ]
    testWorld.addBody(testBody)
  }
  var interval = Meteor.setInterval(function () {
    testWorld.step(0.017)
    stepCount++
  }, 1)
  Meteor.setTimeout(function () {
    Meteor.clearInterval(interval)
    cb(stepCount)
  }, 1000)

}