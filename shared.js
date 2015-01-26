Players = new Mongo.Collection('Players')
Bodies = new Mongo.Collection('Bodies')
Hosts = new Mongo.Collection('Hosts')

StateStream = new Meteor.Stream('State')

Config = {
  defaultPassword: 'peer2peer',
  world: {
    gravity: [0, 9]
  }
}