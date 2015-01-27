Players = new Mongo.Collection('Players')
Bodies = new Mongo.Collection('Bodies')
Hosts = new Mongo.Collection('Hosts')

StateStream = new Meteor.Stream('State')
InputStream = new Meteor.Stream('Input')

Config = {
  defaultPassword: 'peer2peer',
  world: {
    gravity: [0, 0]
  },
  keyMap: {
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down'
  },
  interpolation: {
    pps: 6
  }
}

// This stuff is just for demo purposes (switching interpolation modes etc)
ModeSwitches = new Mongo.Collection('ModeSwitches')
