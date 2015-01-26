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
var update = simpleUpdate
var snapshots = []

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
})

Template.game.rendered = function () {
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

  StateStream.on('State', function (snapshot) {
    snapshots.push(snapshot)
  })

  $(document).click(function (e) {
    console.log(e.pageX, e.pageY)
    if (isHost) handleInput([e.pageX, window.innerHeight - e.pageY], player.body.id)
    else InputStream.emit('Input', { position: [e.pageX, window.innerHeight - e.pageY], worldId: player.body.id })
  })
}

function simpleUpdate (time) {
  var deltaTime = (time - lastRender) / 1000
  lastRender = time
  if (isHost) {
    var bodyStates = p2World.bodies.map(function (body) {
      return {
        id: body.id,
        position: body.position
      }
    })
    StateStream.emit('State', bodyStates)
    if (Date.now() - lastSave > 5000) saveState()
    p2World.step(deltaTime || 0.017)
  } else {
    var snapshot = snapshots[snapshots.length - 1]
    if (snapshot) {
      snapshot.forEach(function (body) {
        var p2Body = p2World.getBodyById(body.id)
        p2Body.position = body.position
      })
      snapshots = []
    }
  }
  renderBodies()
  renderer.render(stage)
  requestAnimationFrame(update)
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

function handleInput (position, playerWorldId) {
  var playerBody = p2World.getBodyById(playerWorldId)
  if (!playerBody) return
  console.log(playerBody)
  var positionVector = [
     position[0] - playerBody.position[0],
     position[1] - playerBody.position[1],
  ]
  console.log('positionVector:', positionVector)
  var forceVector = normalizeVector(positionVector)
  console.log(forceVector)
  playerBody.applyForce(forceVector, playerBody.position)
}

function normalizeVector (v) {
  var length = Math.sqrt((v[0] * v[0]) + (v[1] * v[1]))
  v[0] /= length
  v[1] /= length
  v[0] *= 5000
  v[1] *= 5000
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
      console.log('Body added:', body)
      startSimulatingBody(body)
    },
    removed: function (body) {
      console.log('Body removed:', body)
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
      damping: 0.5,
      data: {
        username: player.username
      }
    })
  }
}

function startSimulatingBody (document) {
  var existingBodies = p2World.bodies.filter(function (body) {
    if (body.id === document.worldId) {
      console.log('body with id', body.id, 'exists')
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
  if (document.data && Meteor.user() && document.data.username === Meteor.user().username) player.body = p2Body
}

function stopSimulatingBody (body) {
  p2World.removeBody(p2World.getBodyById(body.worldId))
}

function initRender () {
  stage = new pixi.Stage(0x000000)
  // We add physics objects to the world, then move the "camera" by changing the world's position
  pixiWorld = new pixi.DisplayObjectContainer()
  ui = new pixi.DisplayObjectContainer()
  stage.addChild(pixiWorld)
  // The UI should be static tho
  stage.addChild(ui)
  renderer = new pixi.autoDetectRenderer(window.innerWidth, window.innerHeight, {
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