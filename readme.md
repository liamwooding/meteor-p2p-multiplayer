## Minimum viable

Input events from players must be sent to the host/server which calculates the results and pushes the new state back to clients. Every time the client calls render, it draws the world according to the most recent update from the StateStream.
- Updates can use much lower bandwidth
- Requires no client-side physics processing
- Lag will be very noticeable on clients with a less-than-perfect connection - lots of stalling & teleporting
- Ideal for LAN networks
- With a bit of buffering & interpolation, could work well for mobile devices on the same network
- Physics engine doesn't need to be deterministic with this model, as it's only being run in one place
- Requires updates to be published by the host as fast as we want them to be rendered on the client

## Interpolating between snapshots

This works the same way as our minimum viable, but instead of publishing state 60 times a second and rendering updates as soon as they're received, we publish "snapshots" of our game state less frequently and interpolate between updates. Instead of instantly rendering the most recent state received, we keep the first snapshot and don't start rendering until we have another one to interpolate towards. If we limit our publish rate to 10pps and we want to target 60fps rendering on the client, we have to draw 5 interpolated frames for each snapshot we receive.
However, we'll still see jittering if we haven't received a new snapshot by the time we're done interpolating towards the last one. To smooth this out, we delay the client even more and keep several buffered snapshots at a time, so that even if we lose a couple in a row we probably still have something to interpolate towards.
The other problem is that simple interpolation between positions won't look as good as the real thing (e.g. an object moving in a circle will appear to be moving in straight lines between points around the circle), although this can be improved by using more sophisticated interpolation techniques.
We still don't need any client-side physics processing for this technique, making it a good choice for networks of devices with reasonable connections but low-power processors. Of course, at least one device will need to have enough power to handle processing and publishing.
The major drawback of this technique is that the player will not move immediately on input - if they try to walk forward, they must wait for their input to reach the host, for the host to advance the simulation, and for the results of that simulation to be sent back to the client before they see their character walking forward.

## Client-side prediction

This is where things get more complicated. We use a similar technique to snapshot interpolation, but instead of interpolating between buffered snapshots, we render physics on the client based on snapshots received from the host. Our simulation doesn't need to be completely deterministic, but we will see artifacts if our send rate is low and the client and host are disagreeing on the simulation.
- Much higher bandwidth & CPU usage
- This can be mixed with the interpolation method - physical bodies that we don't need to simulate too accurately can be interpolated on the client side to reduce CPU usage.
- We can also adjust the send rates for the states of different classes of objects - while we want to be sure that the player is in the right position all the time, we could limit sending the positions of other players and scenery objects to every 2nd packet, for example. Could also decide on importance of objects based on distance from player.
- The host has authority over all clients - when disagreements arise, the host's reality becomes the one true reality.
This gives us the best of both worlds - the player sees a result as soon as an input is pressed, but authority still resides with the host. Disagreements will only arise if the simulation is not deterministic, or when the player is bumped by other players
This presents an interesting problem: when host and client disagree on where the player should be, the player needs to correct itself based on the host's snapshot. However, when the client receives this snapshot the player will be *where it guessed it would be now*, and the snapshot from the host will tell the player *where it was when the host sent the snapshot*, meaning that if it corrects its position in the most basic manner it will actually be *rewinding time from the player's perspective*.
To work around this, the client keeps a frame buffer of past states & inputs. When it receives a snapshot from the host, it discards any frames older than the snapshot and, if there is a disagreement, rewinds the player back to that snapshot then re-runs all inputs in the buffer. This presents 2 new problems:
- We have to run the simulation at a much higher speed than usual when there's a disagreement in order to catch up, which is going to put more strain on the CPU if disagreements are common. We can mitigate this by freezing all other bodies in the world while we do our quick-rewind.
- We need to interpolate between the player's guessed position and their 'real' position or they'll seem to teleport - this is less of a problem if the camera isn't fixed to the player. This interpolation might need to be smart though, as it could see the player being interpolated through walls and other scenery.

## Overview of client-side prediction implementation

The server manages users, updating the Players collection as users connect and disconnect. All users subscribe to Players, which contains names, scores and other info to be displayed in the UI.

The server selects the first connected player to be the host, adding a new document to Hosts with the player's userId and an index/timestamp. Once we have multiple players, we'll start periodically running a test on each client machine to determine its "host score", which is a function of connection quality and processing speed. If there is a large difference between the host's and highest-scoring client's scores, we switch hosts. Clients should not need to be aware of who the host currently is - they just listen to collections and streams.

The host takes responsibility for advancing the simulation and publishing to two places:
- The Bodies collection - a MongoDB collection
  - Updated less frequently (periodically every few seconds, and when a body is added/removed)
  - Each document represents a physical body in the simulation
  - Has all information the physics engine needs to simulate the body (polygons, mass, friction etc)
  - Has all information the rendering engine needs to draw the body (shape, colour, player info if it represents a player)
  - There may be some overlap between information used by the physics & rendering engines, e.g. shape.
- The State Stream - an @arunoda Meteor Stream (future nice - use WebRTC)
  - Updated very frequently (likely 10-60 times a second)
  - Publish updated information about physical bodies: {
    - Sequence number
    - ID used by both the physics and render engines
    - Position
    - Velocity
    - Angular velocity
    - State changes (body removed, player's score changes etc)
    - Input events (if body represents a player - so we can show effects e.g. rocket boosters)
    }
  - This will be published to as often as 60 times a second, so each publication should have been compressed as much as possible
  - During development, we should constantly be looking at the contents of the stream and seeing if we can "downgrade" information which is not super time-sensitive to be published to a collection instead (ideally only if it doesn't affect the physical simulation in any way, so as to avoid rubber-banding/teleporting when clients are corrected by the host)

When players connect, they follow these steps:
- Subscribe to Players and start rendering all relevant info in the UI, which is ideally reactive HTML
- Subscribe to Bodies and start simulating & rendering the body (although make it invisible until we start receiving updates from StateStream, because the position may be non-existent or outdated)
- Listen to StateStream and update the positions of all bodies whose IDs are present in the received messages. The StateStream and the Bodies collection can get out of sync and probably will be when a player first connects, so we should expect to receive updates with IDs that we can't find in the client-side simulation

### Pub/sub logic (pub > sub)

- Players
  - Server > Host & Clients
  - Clients can add/update players with their own userIds
- Bodies
  - Host > Clients
- Hosts
  - Server > Host & Clients
- StateStream
  - Host > Clients

### Pseudo-code

#### Client
- Connect to Meteor server
- Log in
- Subscribe to Bodies collection
- Initialise physics (p2World)
- Start simulating all bodies in collection
- Template rendered
- Start rendering p2World
- Listen for