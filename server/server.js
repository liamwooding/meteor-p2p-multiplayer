Meteor.publish('Players', function () {
  return Players.find()
})
Meteor.publish('Bodies', function () {
  return Bodies.find()
})
Meteor.publish('Hosts', function () {
  return Hosts.find({}, { sort: { index: -1 }, limit: 1 })
})
Meteor.publish('ModeSwitches', function () {
  return ModeSwitches.find()
})

Meteor.startup(function () {
  Players.remove({})
  Bodies.remove({})
  Hosts.remove({})

  Players.allow({
    insert: function (userId, player) {
      return player.userId === userId
    },
    update: function (userId, player) {
      console.log(userId, player.userId)
      return player.userId === userId
    }
  })

  Hosts.allow({
    insert: function () {
      return true
    }
  })

  Meteor.methods({
    newHost: function (username) {
      var player = Players.findOne({ username: username })
      if (!player) return
      console.log('Assigning new host:', player)
      Hosts.insert({
        index: Hosts.find().count(),
        userId: player.userId,
        username: player.username
      })
    },
    newMode: function (mode) {
      if (['simple', 'simpleInterpolate'].indexOf(mode) !== -1) {
        ModeSwitches.insert({ name: mode })
      }
    }
  })

  Bodies.allow({
    insert: function (userId, body) {
      if (Hosts.find({}, { sort: { index: -1 }, limit: 1 }).fetch().some(function (host) { return userId === host.userId })) return true
      return false
    },
    update: function (userId, body) {
      if (Hosts.find({}, { sort: { index: -1 }, limit: 1 }).fetch().some(function (host) { return userId === host.userId })) return true
      return false
    },
    remove: function (userId, body) {
      if (Hosts.find().fetch().some(function (host) { return userId === host.userId })) return true
      return false
    }
  })

  SnapshotStream.permissions.write(function (eventName, args) {
    return true
  })
  InputStream.permissions.write(function (eventName, args) {
    return true
  })
  SnapshotStream.permissions.read(function (userId, eventName) { return true })
  InputStream.permissions.read(function (userId, eventName) { return true })

  Accounts.onLogin(function (args) {
    if (args.error) return console.error(args.error)
    if (args.user && Hosts.find().count() === 0) assignHost(args.user)
    if (Players.find({ username: args.user.username }).count() === 0) {
      Players.insert({
        userId: args.user._id,
        username: args.user.username
      })
    }
  })
})

function assignHost (user) {
  console.log('Assigning new host:', user.username)
  Hosts.insert({
    index: Hosts.find().count(),
    userId: user._id,
    username: user.username
  })
}