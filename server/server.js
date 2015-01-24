Meteor.publish('Players', function () {
  return Players.find()
})
Meteor.publish('Bodies', function () {
  return Bodies.find()
})
Meteor.publish('Hosts', function () {
  return Hosts.find()
})

Players.allow({
  insert: function (userId, player) {
    if (player.userId === userId) return true
    else return false
  },
  update: function (userId, player), {
    if (player.userId === userId) return true
    else return false
  }
})

Bodies.allow({
  insert: function (userId, player) {
    if (Hosts.find().fetch().some(function (host) { userId === host.userId })) return true
    else return false
  },
  update: function (userId, player), {
    if (Hosts.find().fetch().some(function (host) { userId === host.userId })) return true
    else return false
  },
  remove: function (userId, player), {
    if (Hosts.find().fetch().some(function (host) { userId === host.userId })) return true
    else return false
  }
})

StateStream.permissions.read(function (userId, eventName) {
  return true
})

Meteor.startup(function () {
  Players.remove({})
  Bodies.remove({})
  Hosts.remove({})
})