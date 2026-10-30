# Collaboration behavior

Peers in the same room exchange an initial document snapshot and supported element
add/update/delete commands. Operations carry spread IDs, so peers can view different
spreads without edits landing on the wrong page. Receiving an element edit does not
change local pan, zoom, spread, or selection except when a selected element is deleted.

A join snapshot is targeted to its requester and accepted only once. Local element
editing cancels a pending snapshot to prevent late synchronization from overwriting
new work. Join an existing session before starting to edit. Opening a room joins the
shared publication; export a copy of any separate local publication first.

New operations carry logical counters and peer IDs. Concurrent changes to the same
element resolve to the same complete element on all peers, using the counter and
peer-ID order. Deletion versions prevent delayed updates from resurrecting elements.
This is element-level last-writer-wins, not character-level collaborative text merging.
Simultaneous typing in the same frame can lose one participant's edit.

Supported local element commands use the existing mutation hooks. Page/spread changes,
style definitions, undo/redo, bulk scripts, and commands that bypass those hooks are
not continuously synchronized. Initial synchronization includes those document fields.
Mixed older clients have no conflict guarantees; legacy operations are accepted only
when their target can be identified unambiguously by element/page ID.

Malformed remote elements and snapshots are validated before committing. Wrong-room,
wrong-recipient, and unauthorized messages are ignored. The existing room password
hash is not a replacement for a full authentication or authorization system.

Automated tests exercise independent state managers through queued BroadcastChannel
messages. Live internet/WebRTC connectivity, simultaneous room creation, reconnect
reconciliation, and packet loss/recovery still require browser/network testing.
