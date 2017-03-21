This is just a basic alarm clock that's configurable via a TCP connection (by default `127.0.0.1:16295`).

Installtion
===========
Probably works on any version of Node, doesn't require much at all.  
The daemon needs write access to `alarms.json` to save alarm data.

Alarm noises/sounds go into `./alarms`.

Node Packages
-------------
* play-sound
* node-schedule

Commands
========
* `create alarmname description_words time days,of,week,0-6`  
e.g. `create school_0700 i_need_to_get_up_early 6:00 1,2,3,4,5`
* `delete alarmname`  
e.g. `delete school_0700`
* `list`
* `reload`
* `snooze`
* `toggle alarmname`  
e.g. `toggle school_0700`
* `exit`