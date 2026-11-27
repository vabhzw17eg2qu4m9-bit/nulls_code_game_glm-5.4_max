// DEEPWAKE, the complete course (contract §4): four regions west to east, authored as ASCII maps.
//
// ROUTE, west to east. (x, y) is where ILO's feet stand or land. "jump" = held jump, "tap" = tapped jump,
// "climb" = wall-jump climb: hold toward a wall, press jump, alternate walls. M = main line, D = detour.
//   M01 (4.5, 6) spawn. Walk east to station st1 (7.5, 6). Sign MOVE.
//   M02 (11, 6) tap jump onto the step block (top 7); walk off its east side to (13, 6); through the trench
//        (x 15 to 17, floor 5: walk in, tap out at 18).
//   M03 (20.5, 6) sign JUMP. (22, 6) jump east over the 3-unit gap; land at (26, 6). A short jump lands on the pit
//        floor (4): two 1-up steps (x 24, floor 5) lead back up.
//   M04 (27.9, 6) sign DASH. (29.5, 6) dash east through the training seam (x 30); land at (33, 6).
//   M05 (34.5, 6) sign ECHO PULSE: an observation spot (the skitter's box never comes west of x 36). Pulse: the
//        reveal marker (34.5, 7) shows the conduit wsConduit, and the pulse reaches wsSkitter wherever it is.
//   M06 (36 .. 41, 6) pass the skitter wsSkitter (patrol x 36.6 to 40.4; its box reaches x 36): walk on while it
//        is stunned (2 s), or tap over it.
//   M07 (41, 6) jump 2 up onto crate A (x 42 to 43, top 8); jump 2 up onto crate B (x 44 to 45, top 10).
//   M08 (45, 10) walk east off crate B into the corridor beneath the gallery (47 .. 48, 6). Interact sign (49.5, 8).
//   M09 (48.5, 6) interact: take the cell wsCell. Carry it 2 units east on flat ground. (50.5, 6) interact: insert
//        into wsSocket (Circuit). The shutter wsShutter (x 54) opens.
//   M10 (54, 6) walk east through the shutter slot into the relay chamber. No gap.
//   M11 (57.5, 6) pulse: Relay A. (59.5, 6) station st2.
//   M12 (62 .. 70) walk east down the terraces (floors 6, 5, 4) to the bank (71, 3).
//   M13 (73, 3) jump east over the water (gap 3) onto island 1 (76 .. 79, 3). (80, 3) jump (gap 2) onto island 2
//        (82 .. 85, 3). (86, 3) jump (gap 2); land at (88, 3).
//   M14 (90, 3) walk east under the wall into shaft 1 (x 91 to 94). Sign WALL JUMP (89, 4). Climb; leave east at
//        (96, 13).
//   M15 (96, 13) walk east through the open passage (x 97) to (99, 13).
//   M16 (99, 13) walk east into the switch shaft (x 100 to 103). Climb to about 19; leave east at 21 into the
//        alcove (105 .. 108, 21).
//   M17 (107.5, 21) interact: switch resSwitch (Bridge) starts the platform resBridge.
//   M18 (104, 21) walk west off the alcove and drop into the shaft (floor 13). Walk east out to (106.5, 13).
//   M19 (106.5, 13) observation spot: the cover block (x 107 to 109, y 13 to 15) hides ILO from the drone
//        resDrone (patrol x 111.5 to 112, 16). A drone sees 6 units, as far as a pulse reaches: a drone that
//        begins to aim is always inside a pulse from wherever ILO stands. Jump 2 up onto the block; the drone
//        aims and fires 0.8 s later. Pulse the moment it aims (it is stunned 2.5 s), then dash east from the
//        block's east end (109.2, 15) into it.
//        Bypass, no disable (tests/bypass.test.mjs, B19): the same pulse as it aims; from the block walk east,
//        drop into the basin (x 109 to 110, floor 11); pulse again (the stun starts anew); jump 2 up east onto
//        the ledge (111 .. 118, 13) and run on: (118.6, 13) is out of its sight before the stun is over.
//   M20 (118.6, 13) stand at the ledge's east edge. The platform resBridge (3 wide) pauses 1.5 s at the west end
//        (x 119): board, ride 9 units, walk off east at (131, 13).
//   M21 (132.5, 13) pulse: Relay B. (134.5, 13) station st3.
//   M22 (136, 13) walk east through the doorway into shaft 2 (x 137 to 140). Climb; leave east at (141, 22); walk
//        east into the foundry.
//   M23 (143, 22) walk east into the sentinel corridor. (144.5, 22) is an observation spot: the sentinel
//        fndSentinel (154.5, 22; its beam reaches 8 units west) stays closed until ILO steps into its lane
//        (x 146 to 153, 22); it then warns 0.9 s before it fires. Step in, drop into the cover recess (x 148 to
//        150, floor 21) before the beam, and when it vents (2 s) hop out at once and run east to (157.6, 22).
//   M24 (157.6, 22) jump east over the 3-unit pit gap; land at (162.9, 22).
//   M25 (162.5, 22), (165.5, 22), (168.5, 22) observation spots before the timed vents fndVent1 to fndVent3
//        (x 164.5, 167.5, 170.5; period 4, delays 0, 1.3, 2.6): watch a jet from its spot, cross right after
//        it ends. Walk on to (174.5, 22).
//   M26 (174.5, 22) interact: take the cell fndCell. Carry it east on flat ground to (175.5, 22); tap east onto
//        the cabin fndLift (x 176 to 179, deck 22.6).
//   M27 (178.9, 22.6) interact: insert into fndLiftSocket (180.5, Lift; the prompt shows from x 178.8, further
//        west E puts the cell down). Ride the cabin up 8 (deck 30.6); tap east onto the upper level (182, 30).
//   M28 (184.5, 30) interact: switch fndUpperSwitch (Latch) opens the shutter fndUpper (x 183, ground level).
//   M29 (181, 30) walk back west to the gap over the walkway (x 176 to 181); drop; land at (180, 22).
//   M30 (180, 22) interact: remove the cell (the cabin sinks). Carry it east through the open shutter slot (x 183)
//        to (186.5, 22): interact, insert into fndRelaySocket (Relay).
//   M31 (188.5, 22) pulse: Relay C. (191.5, 22) station st4.
//   M32 (193, 22) walk east through the entrance shutter ascEntrance (open: Relay C) to (196, 22); under its wall
//        into shaft 1 (x 197 to 200). Climb; leave east at (201, 36).
//   M33 (202.4, 36) step east down 0.5 onto the service platform ascPlatform (x 204 to 207; it rests 1.5 s at
//        each end). Ride it up 18; tap east onto the ledge at (208, 54).
//   M34 (208.5, 54) observation spot before the timed vent ascVent1 (x 211.5; period 4): cross right after its
//        jet. (214.5, 54) jump 2 up onto the block (x 216, top 56).
//   M35 (216.4, 56) the drone ascDrone (patrol x 219.5 to 220, 56) sees ILO on the block and aims: pulse the
//        moment it does (sight 6 = pulse reach), then dash east from the block into it. Walk east under the
//        opening (x 221) into shaft 2 (x 222 to 225).
//        Bypass, no disable (B35): the same pulse, then walk east under the drone into shaft 2 and climb at once:
//        above its floor the wall between the shafts (x 221, y 57 to 66) hides ILO before the stun is over.
//   M36 (223.5, 54) climb; leave east at the passage (x 226, 66) onto the top platform (x 227 to 231, 66).
//   M37 (top platform) interact: the console (marker `ascent`) starts the lift sequence.
//   D1 cache1: from the step block (13.2, 7) jump east 2 up onto the slab (x 15 to 17, top 9); cache1 (16.5, 9).
//        Drop back onto the step block (13, 7).
//   D2 archive A: from crate B (45, 10) pulse (reveal marker 49.5, 11), dash east through the hidden seam (x 47,
//        y 10 to 12); land on the gallery (48, 10). Archive A (52.5, 10). Back: walk west off the gallery into
//        the slot (47, 6).
//   D3 archive B: from the foundry floor run west and jump at the balcony edge (take off between x 140.65 and
//        141.2, y 22) into the shelf; land at (136.8, 24). Archive B (134.5, 24). Back: walk
//        east off the shelf into shaft 2; land at (139, 13).
//   D4 archive C: drop into the pit at (158.6, 20) and (159.5, 18). Pulse (reveal marker 159.5, 19); dash east
//        through the hidden seam (x 161, y 18 to 20); land in the service room (162 .. 170, floor 18). Archive C
//        (167.5, 18). Back: tap west through the opening into the pit (159.8, 18); jump west onto the step
//        (158.4, 20); jump 2 up to (157.3, 22).
//   D5 cache3: on the upper level walk east past the switch. The press fndPress1 (x 188, down 2) sweeps the
//        floor: wait west of it, cross after it rises. cache3 (192.5, 30).
//   D6 cache2: after M19, from the ledge (111.2, 13) walk west off it into the basin (110.3, 11): the prompt asks
//        for a pulse. Pulse: the reveal marker (109.5, 12) lights the hidden seam (x 108, y 10 to 13), the west
//        wall of the basin. Dash west through it: the corridor floor above the room stops the dash over the
//        opening, and ILO lands in it (108.4, 10). Walk west into the room (x 104 to 107, floor 10): cache2
//        (105.5, 10). Back: east into the opening, where there is headroom (the room is 2 units tall); tap east
//        onto the basin floor (one unit up); 2 up east onto the ledge; walk east to (118.6, 13).
//
// Coordinates: x grows east, y grows up, one terrain cell is one unit, a cell (x, y) spans x to x + 1 and y to y + 1.
// Each region states its origin; the region x ranges are contiguous. Marker chars are declared once per region.

import { defineLevel } from './build.js';

// Buried Workshop (x 0 to 62): spawn, lessons in moving, jumping, dashing and pulsing, the circuit and Relay A.
// Rows run top to bottom, one character is one unit: # rock, % seam, . open. A marker stands in the cell above its floor.
const workshop = {
  id: 'workshop', name: 'Buried Workshop', origin: { x: 0, y: 0 },
  map: [
    '##############################################################',
    '##############################################################',
    '##############################################################',
    '#...........###########################........%.....#########',
    '#.........................#############........%.e...#.#######',
    '#.........................#############........%....A#........',
    '#......####.....c...........................##.#######........',
    '#..............###............%.............##................',
    '#.............................%...h.......####................',
    '#...P..1...##.................%.......k...####..C.o...t..R.2..',
    '###############...####...#####################################',
    '######################..######################################',
    '##############################################################',
    '##############################################################',
    '##############################################################',
    '##############################################################',
  ],
  markers: {
    1: {'kind':'station','id':'st1'},
    2: {'kind':'station','id':'st2'},
    P: {'kind':'spawn'},
    c: {'kind':'cache','id':'cache1'},
    k: {'kind':'skitter','id':'wsSkitter','range':[-1.9,1.9]},
    h: {'kind':'reveal','id':'wsConduitHint','reveal':'conduit','ref':'wsConduit'},
    e: {'kind':'reveal','id':'wsAlcoveHint','reveal':'seam','ref':'wsAlcove'},
    A: {'kind':'archive','id':'A','title':'Workshop Roster','text':'Day 312. The crew fitted the maintenance units with resonance coils so they could hear the rock. By nightfall the units refused every order to dig deeper.'},
    C: {'kind':'cell','id':'wsCell'},
    o: {'kind':'socket','id':'wsSocket','label':'Circuit','powers':['wsShutter']},
    t: {'kind':'shutter','id':'wsShutter','w':1,'h':3,'open':[0,3],'poweredBy':['wsSocket']},
    R: {'kind':'relay','id':'A','station':'st2','lookAt':[5,1]},
  },
  seamInfo: [ {'at':[30,9],'id':'wsTrain'}, {'at':[47,5],'id':'wsAlcove','hidden':true} ],
  camera: [
    {'id':'wsHall','x0':0,'y0':0,'x1':78,'y1':16},
  ],
  decor: [
    {'kind':'lamp','x':1.5,'y':10.5,'tone':'warm'},
    {'kind':'sign','x':3.6,'y':7.3,'text':'{left} {right} - MOVE'},
    {'kind':'cable','x':5.6,'y':13,'len':0.8},
    {'kind':'cable','x':6.3,'y':13,'len':0.5},
    {'kind':'lamp','x':9.5,'y':12.4,'tone':'warm'},
    {'kind':'column','x':7.4,'y':10,'h':3},
    {'kind':'toolrack','x':8.55,'y':10,'w':1},
    {'kind':'bench','x':10,'y':10},
    {'kind':'lamp','x':13.6,'y':10.6,'tone':'warm'},
    {'kind':'sign','x':20.5,'y':7.3,'text':'{jump} - JUMP · HOLD FOR HEIGHT'},
    {'kind':'cable','x':23.5,'y':12,'len':0.7},
    {'kind':'lamp','x':26.4,'y':8.5,'tone':'warm'},
    {'kind':'sign','x':27.9,'y':7.3,'text':'{dash} - DASH'},
    {'kind':'conduit','id':'wsConduit','points':[[31.5,9.6],[38.5,9.6]]},
    {'kind':'sign','x':34.5,'y':7.3,'text':'{pulse} - ECHO PULSE · REVEALS AND STUNS'},
    {'kind':'lamp','x':40.5,'y':11.6,'tone':'warm'},
    {'kind':'sign','x':49.5,'y':7.9,'text':'{interact} - INTERACT'},
    {'kind':'lamp','x':52.5,'y':8.5,'tone':'warm'},
    {'kind':'cable','x':54.5,'y':12,'len':0.6},
    {'kind':'lamp','x':55.4,'y':9.6,'tone':'warm'},
    {'kind':'conduit','id':'wsConduitA','points':[[57.5,10.6],[61.5,10.6]],'poweredBy':['A']},
    {'kind':'lamp','x':60.4,'y':9.6,'tone':'warm'},
  ],
};

// Crystal Reservoir (x 62 to 142): terraces down to the water at y 2, islands, the first wall-jump shaft, the drone and the switch shaft, the bridge channel, Relay B, the climb to y 22. A pulse-revealed side room with cache2 lies under the corridor east of the switch shaft.
// Rows run top to bottom, one character is one unit: # rock, % seam, . open. A marker stands in the cell above its floor.
const reservoir = {
  id: 'reservoir', name: 'Crystal Reservoir', origin: { x: 62, y: -2 },
  map: [
    '################################################################################',
    '#####################################################################...........',
    '######################################.........######################...........',
    '######################################.........######################...........',
    '######################################.........######################...B.......',
    '######################################.........############################.....',
    '######################################.........############################.....',
    '######################################.......w.############################....#',
    '######################################....#################################....#',
    '######################################....#################################....#',
    '#################################....#....#..............##################....#',
    '###########..........................#....#..........................######....#',
    '###########..........................#....#......d........................#....#',
    '###########.................#..................................................#',
    '............................#................##................................#',
    '............................#................##...........b...........R.3......#',
    '............................#....#############%e.########............###########',
    '............................#....#########....%..########............###########',
    '............................#....#########.c..%##########............###########',
    '.########...................#....########################............###########',
    '............................#....########################............###########',
    '............................#....########################............###########',
    '............................#....########################............###########',
    '###..............................########################............###########',
    '######...........................########################............###########',
    '#########........................########################............###########',
    '###########...####..####..###############################............###########',
    '###########...####..####..###############################............###########',
    '###########...####..####..###############################............###########',
    '###########...####..####..###############################............###########',
    '################################################################################',
  ],
  markers: {
    3: {'kind':'station','id':'st3'},
    e: {'kind':'reveal','id':'resPassageHint','reveal':'seam','ref':'resPassage'},
    w: {'kind':'switch','id':'resSwitch','label':'Bridge','targets':['resBridge']},
    d: {'kind':'drone','id':'resDrone','to':[0.5,0]},
    b: {'kind':'platform','id':'resBridge','to':[9,0],'w':3,'speed':2,'pauseA':1.5,'pauseB':1.5,'poweredBy':['resSwitch']},
    R: {'kind':'relay','id':'B','station':'st3','lookAt':[5,5]},
    B: {'kind':'archive','id':'B','title':'Reservoir Survey','text':'The crystals answer each pulse with the same three notes. Dr. Voss called it a reply. Command ordered the relays to full power instead.'},
    c: {'kind':'cache','id':'cache2'},
  },
  seamInfo: [ {'at':[46,17],'id':'resPassage','hidden':true} ],
  kill: [ {'x0':73,'y0':-1,'x1':88,'y1':2,'kind':'water'}, {'x0':119,'y0':-1,'x1':131,'y1':2,'kind':'water'} ],
  camera: [
    {'id':'rsEntry','x0':49,'y0':-2,'x1':113,'y1':20},
    {'id':'rsHall','x0':82,'y0':8,'x1':157,'y1':28},
  ],
  decor: [
    {'kind':'lamp','x':62.5,'y':8.5,'tone':'teal'},
    {'kind':'crystal','x':63.6,'y':10,'size':0.8},
    {'kind':'pool','x':64.5,'y':10,'w':3},
    {'kind':'waterfall','x':64.5,'y':15,'h':5},
    {'kind':'pool','x':69,'y':10,'w':3},
    {'kind':'waterfall','x':69,'y':15,'h':5},
    {'kind':'crystal','x':70.4,'y':10,'size':0.8},
    {'kind':'lamp','x':72.4,'y':5.5,'tone':'teal'},
    {'kind':'shelf','x':78,'y':13,'w':5},
    {'kind':'crystal','x':78.6,'y':13.5,'size':1.2},
    {'kind':'shelf','x':85.5,'y':10.5,'w':3},
    {'kind':'crystal','x':85.2,'y':11,'size':0.9},
    {'kind':'bridge','x':80.5,'y':12,'w':7},
    {'kind':'crystal','x':74.6,'y':-1,'size':1.4},
    {'kind':'crystal','x':86.6,'y':-1,'size':1},
    {'kind':'sign','x':89,'y':4.3,'text':'HOLD TOWARD A WALL · {jump} TO WALL JUMP'},
    {'kind':'lamp','x':89.4,'y':9.5,'tone':'teal'},
    {'kind':'conduit','id':'rsConduitA','points':[[62.5,14.6],[72.5,14.6]],'poweredBy':['A']},
    {'kind':'lamp','x':108.6,'y':23.2,'tone':'teal'},
    {'kind':'lamp','x':106.5,'y':12,'tone':'teal'},
    {'kind':'lamp','x':118.4,'y':15.5,'tone':'teal'},
    {'kind':'bridge','x':125,'y':17.3,'w':9},
    {'kind':'lamp','x':136.4,'y':15.5,'tone':'teal'},
    {'kind':'conduit','id':'rsConduitB','points':[[132.5,16.6],[136.5,16.6]],'poweredBy':['B']},
    {'kind':'lamp','x':131.5,'y':26.5,'tone':'teal'},
  ],
};

// Silent Foundry (x 142 to 193): the sentinel corridor, the vents, the counterweight lift, Relay C; floor 22.
// Rows run top to bottom, one character is one unit: # rock, % seam, . open. A marker stands in the cell above its floor.
const foundry = {
  id: 'foundry', name: 'Silent Foundry', origin: { x: 142, y: 14 },
  map: [
    '###################################################',
    '###################################################',
    '###################################################',
    '##################################..........##.....',
    '##################################..........##.p...',
    '##################################.................',
    '##################################........s.......c',
    '##################################.....############',
    '##......##########################.................',
    '##......##########################.................',
    '##......##########################.................',
    '...................................................',
    '...................................................',
    '...................................................',
    '............S.........v..V..w...C..L..l..U..r.R..4.',
    '######...#######...################################',
    '################...%........#######################',
    '#################e.%........#######################',
    '#################..%.....A..#######################',
    '###################################################',
    '###################################################',
    '###################################################',
    '###################################################',
  ],
  markers: {
    4: {'kind':'station','id':'st4'},
    S: {'kind':'sentinel','id':'fndSentinel','dir':-1,'length':8},
    e: {'kind':'reveal','id':'fndServiceHint','reveal':'conduit','ref':'fndServiceConduit'},
    A: {'kind':'archive','id':'C','title':'Foundry Directive','text':'Last order of the day: seal the lower decks, keep the ascent lift awake, leave one small unit on standby. Someone has to restore the signal.'},
    v: {'kind':'vent','id':'fndVent1','h':3,'period':4,'warn':0.8,'active':1.2,'delay':0},
    V: {'kind':'vent','id':'fndVent2','h':3,'period':4,'warn':0.8,'active':1.2,'delay':1.3},
    w: {'kind':'vent','id':'fndVent3','h':3,'period':4,'warn':0.8,'active':1.2,'delay':2.6},
    L: {'kind':'lift','id':'fndLift','to':[0,8],'w':3,'speed':2.5,'poweredBy':['fndLiftSocket']},
    l: {'kind':'socket','id':'fndLiftSocket','label':'Lift','powers':['fndLift']},
    C: {'kind':'cell','id':'fndCell'},
    U: {'kind':'shutter','id':'fndUpper','w':1,'h':3,'open':[0,3],'poweredBy':['fndUpperSwitch']},
    r: {'kind':'socket','id':'fndRelaySocket','label':'Relay','powers':['C']},
    R: {'kind':'relay','id':'C','station':'st4','socket':'fndRelaySocket','lookAt':[4,1]},
    s: {'kind':'switch','id':'fndUpperSwitch','label':'Latch','targets':['fndUpper']},
    p: {'kind':'press','id':'fndPress1','travel':2,'period':4,'warn':1},
    c: {'kind':'cache','id':'cache3'},
  },
  seamInfo: [ {'at':[19,18],'id':'fndServiceSeam','hidden':true} ],
  camera: [
    {'id':'fdHall','x0':118,'y0':14,'x1':216,'y1':36},
  ],
  decor: [
    {'kind':'lamp','x':143.4,'y':24.5,'tone':'warm'},
    {'kind':'machine','type':'piston','x':145.6,'y':26,'w':2,'h':2.6},
    {'kind':'machine','type':'tank','x':148.3,'y':26,'w':2.4,'h':2.6},
    {'kind':'rail','x':147,'y':26,'w':5},
    {'kind':'lamp','x':152.4,'y':24.5,'tone':'warm'},
    {'kind':'cable','x':156.5,'y':26,'len':0.6},
    {'kind':'conduit','id':'fndServiceConduit','points':[[159.5,20.7],[169.5,20.7]],'poweredBy':['B']},
    {'kind':'lamp','x':162.4,'y':20.5,'tone':'warm'},
    {'kind':'lamp','x':168.6,'y':20.5,'tone':'warm'},
    {'kind':'lamp','x':161.4,'y':24.5,'tone':'warm'},
    {'kind':'lamp','x':172.4,'y':24.5,'tone':'warm'},
    {'kind':'lamp','x':174.6,'y':25.5,'tone':'warm'},
    {'kind':'lamp','x':185.4,'y':24.5,'tone':'warm'},
    {'kind':'machine','type':'turbine','x':186.6,'y':26.3,'w':2,'h':2.6},
    {'kind':'conduit','id':'fndConduitC','points':[[188.5,28.6],[192.5,28.6]],'poweredBy':['C']},
    {'kind':'cable','x':190.5,'y':29,'len':0.7},
    {'kind':'lamp','x':182.6,'y':32.5,'tone':'warm'},
    {'kind':'lamp','x':192.4,'y':32.5,'tone':'warm'},
    {'kind':'cable','x':183.4,'y':34,'len':0.4},
  ],
};

// Ascent Shaft (x 193 to 238): from the foundry floor at y 22 up to the lift at y 66 and the terrace at y 84.
// Rows run top to bottom, one character is one unit: # rock, % seam, . open. A marker stands in the cell above its floor.
const ascent = {
  id: 'ascent', name: 'Ascent Shaft', origin: { x: 193, y: 17 },
  map: [
    '#################################......######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '##################################.....######',
    '#############################..........######',
    '#############################..........######',
    '#############################..........######',
    '#############################...........#####',
    '#############################...........#####',
    '#############################.......A...#####',
    '########################....#....############',
    '########################....#....############',
    '########################....#....############',
    '########################....#....############',
    '########################....#....############',
    '########################....#....############',
    '###########...##########....#....############',
    '###########...#######.......#....############',
    '###########.................#....############',
    '###########...............D......############',
    '###########............#.........############',
    '###########.......V....#.........############',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '###########...###############################',
    '####..........###############################',
    '####..........###############################',
    '####..........###############################',
    '####..........###############################',
    '####..........###############################',
    '####..........###############################',
    '####....###.P.###############################',
    '####....#####################################',
    '####....#####################################',
    '####....#####################################',
    '####....#####################################',
    '####....#####################################',
    '####....#####################################',
    '####....#####################################',
    '.###....#####################################',
    '...#....#####################################',
    '...#....#####################################',
    '........#####################################',
    '........#####################################',
    'E.......#####################################',
    '#############################################',
    '#############################################',
    '#############################################',
    '#############################################',
    '#############################################',
  ],
  markers: {
    E: {'kind':'shutter','id':'ascEntrance','w':1,'h':3,'open':[0,3],'poweredBy':['C']},
    P: {'kind':'platform','id':'ascPlatform','to':[0,18],'w':3,'speed':2.5,'pauseA':1.5,'pauseB':1.5},
    V: {'kind':'vent','id':'ascVent1','h':3,'period':4,'warn':0.8,'active':1.2,'delay':1},
    D: {'kind':'drone','id':'ascDrone','to':[0.5,0]},
    A: {'kind':'ascent','boarding':[6,3]},
  },
  camera: [
    {'id':'ascent','x0':164,'y0':20,'x1':238,'y1':96},
  ],
  decor: [
    {'kind':'lamp','x':195.4,'y':24.5,'tone':'warm'},
    {'kind':'conduit','id':'ascConduitC','points':[[193.5,26.6],[195.5,26.6]],'poweredBy':['C']},
    {'kind':'lightShaft','x':199,'y':40,'h':12},
    {'kind':'lamp','x':202.5,'y':38.5,'tone':'warm'},
    {'kind':'lightShaft','x':205.5,'y':60,'h':14},
    {'kind':'lamp','x':208.4,'y':56.5,'tone':'warm'},
    {'kind':'lamp','x':220.6,'y':58.5,'tone':'warm'},
    {'kind':'lightShaft','x':219,'y':66,'h':12},
    {'kind':'lamp','x':226.5,'y':70.5,'tone':'warm'},
    {'kind':'lamp','x':227.6,'y':68.5,'tone':'warm'},
    {'kind':'lamp','x':231.4,'y':68.5,'tone':'warm'},
    {'kind':'lightShaft','x':229.5,'y':84,'h':18},
  ],
};

export const LEVEL = defineLevel({ name: 'DEEPWAKE', regions: [workshop, reservoir, foundry, ascent] });
