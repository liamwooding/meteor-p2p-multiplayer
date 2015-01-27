Meteor.publish('Players', function () {
  return Players.find()
})
Meteor.publish('Bodies', function () {
  return Bodies.find()
})
Meteor.publish('Hosts', function () {
  return Hosts.find({}, { sort: { index: -1 } })
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
      if (player.userId === userId) return true
      else return false
    },
    update: function (userId, player) {
      if (player.userId === userId) return true
      else return false
    }
  })

  ModeSwitches.allow({
    insert: function () {
      return true
    }
  })

  Bodies.allow({
    insert: function (userId, body) {
      if (Hosts.find().fetch().some(function (host) { return userId === host.userId })) return true
      return false
    },
    update: function (userId, body) {
      if (Hosts.find().fetch().some(function (host) { return userId === host.userId })) return true
      return false
    },
    remove: function (userId, body) {
      if (Hosts.find().fetch().some(function (host) { return userId === host.userId })) return true
      return false
    }
  })

  StateStream.permissions.write(function (eventName, args) {
    console.log(eventName, args)
    return true
  })
  InputStream.permissions.write(function (eventName, args) {
    console.log(eventName, args)
    return true
  })
  StateStream.permissions.read(function (userId, eventName) { return true })
  InputStream.permissions.read(function (userId, eventName) { return true })

  Accounts.onLogin(function (args) {
    if (args.error) return console.error(args.error)
    if (args.user && Hosts.find().count() === 0) assignHost(args.user)
    if (Players.find({ username: args.user.username }).count() === 0) {
      Players.insert({
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