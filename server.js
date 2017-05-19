const player = require('play-sound')();
const schedule = require('node-schedule');
const fs = require('fs');
const net = require('net');
const exec = require('child_process').exec;

var alarm_data = require('./alarms.json');

var running = false;
var audio;
var alarms = [];
var alarm_sounds = fs.readdirSync("alarms").map(function(x) {
	return "alarms/" + x;
});

var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function connectMsg(socket) {
	var closest = getClosestAlarm();
	var date_str = new Date(closest.job.nextInvocation()).toLocaleString();
	socket.msg("Next alarm (" + closest.data.name + ") will trigger on " + date_str);
}

var tcp = net.createServer(function(socket) {
	socket.msg = function(msg) {
		this.write(msg + "\r\n");
	}

	connectMsg(socket);

	socket.on('data', function(data) {
		var msg = data.toString('utf8').trim();
		var parts = msg.split(" ");

		var cmd = parts[0];

		switch(cmd) {
			case "snooze":
				stopAlarm();
				socket.msg("++ snoozed");
				break;

			case "exit":
				socket.destroy();
				break;

			case "toggle":
				var wanted_alarm = parts[1];
				
				for(var i in alarms) {
					var data = alarms[i].data;
					if(data.name == wanted_alarm) {
						var found = alarms[i];
						break;
					}
				}

				if(!found) {
					socket.msg("!! couldn't toggle alarm, doesn't exist");
					return;
				}

				if(found.data.enabled) {
					found.data.enabled = false;
					cancelAlarm(found);

					saveAlarms();

					socket.msg("++ alarm disabled");
				} else {
					found.data.enabled = true;
					if(found.job) {
						found.job.cancel();
					}

					var fdata = found.data;
					var rule = new schedule.RecurrenceRule();
					rule.dayOfWeek = fdata.days;
					rule.hour = fdata.time.hour;
					rule.minute = fdata.time.minute;

					found.job = createAlarmJob(found, rule);

					saveAlarms();

					socket.msg("++ alarm enabled");
				}
				break;

			case "create":
				try {
					var name = parts[1];
					
					var description = parts[2].replace("_", " ");

					var time = {
						hour: parseInt(parts[3].split(":")[0]),
						minute: parseInt(parts[3].split(":")[1])
					};
					
					var days = parts[4].split(",").map(function(x) {
						return parseInt(x);
					});
				} catch(err) {
					console.log(err);
					console.log("Couldn't create alarm [1]");
					socket.msg("!! alarm creation failed [1]");
					return;
				}

				for(var i in alarms) {
					var x = alarms[i].data;
					if(x.name == name) {
						socket.msg("!! alarm creation failed, alarm exists");
						return;
					}
				}

				var obj = {
					name: name,
					description: description,
					time: time,
					days: days,
					enabled: true
				};

				try {
					alarms.push(scheduleAlarm(obj));
				} catch(err) {
					console.log(err);
					console.log("Couldn't create alarm [2]");
					socket.msg("!! alarm creation failed [2]");
					return;					
				}

				saveAlarms();
				socket.msg("++ created alarm");
				break;

			case "delete":
			case "remove":
				var name = parts[1];

				for(var i in alarms) {
					var x = alarms[i];
					if(x.data.name == name) {
						var found = x;
						break;
					}
				}

				if(!found) {
					socket.msg("!! alarm doesn't exist, can't remove");
					return;
				}

				cancelAlarm(found);
				alarms.splice(i,1);
				saveAlarms();

				socket.msg("++ deleted alarm");
				break;

			case "reload":
				loadAlarms();
				socket.msg("++ reloaded alarm data");
				break;

			case "list":
				for(var i in alarms) {
					var alarm_data = alarms[i].data;
					var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
					var runs_on_days = alarm_data.days.map(function(x) {
						return days[x];
					}).join(", ");
					var runs_at_time = Object.values(alarm_data.time).join(":");

					socket.msg("===| " + alarm_data.name + " |===");
					socket.msg("...| " + alarm_data.description + " |...");
					socket.msg("ACTIVE:            " + alarm_data.enabled.toString());
					if(alarm_data.enabled) {
						socket.msg("CURRENTLY SET FOR: " + new Date(alarms[i].job.nextInvocation()).toLocaleString());
					}
					socket.msg("RUNS ON:           " + runs_on_days + " at " + runs_at_time);
					socket.msg("\r\n");
				}
				break;

			case "change":
			case "mod":
			case "modify":
				var name = parts[1];

				for(var i in alarms) {
					var x = alarms[i];
					if(x.data.name == name) {
						var found = x;
						break;
					}
				}

				if(!found) {
					socket.msg("!! alarm doesn't exist, can't modify");
					return;
				}
				
				if(found.job) {
					cancelAlarm(found);
				}

				var what = parts[2];

				switch(what) {
					case "days":
						var days = parts[3].split(",").map(function(x) {
							return parseInt(x);
						});
						found.data.days = days;
						break;

					case "time":
						var times = parts[3].split(":").map(function(x) {
							return parseInt(x);
						});
						found.data.time.hour = times[0];
						found.data.time.minute = times[1];
						break;

					default:
						socket.msg("!! not a valid thing to change, use days or time");
						return;
						break;
				}

				var fdata = found.data;
				var rule = new schedule.RecurrenceRule();
				rule.dayOfWeek = fdata.days;
				rule.hour = fdata.time.hour;
				rule.minute = fdata.time.minute;

				found.job = createAlarmJob(found, rule);

				saveAlarms();

				socket.msg("++ alarm modified");
				break;

			case "dismiss":
				var closest = getClosestAlarm();
				cancelAlarm(closest);
				break;

			default:
				var cmds = [
					"create alarmname description_words time days,of,week,0-6",
					"delete alarmname",
					"modify alarmname days/time daysvalue/timevalue",
					"list",
					"reload",
					"snooze",
					"toggle alarmname",
					"dismiss",
					"exit"
				];
				socket.msg("??\r\n" + cmds.join("\r\n"));
				break;
		}
	});
});

tcp.listen(16295, '127.0.0.1');

function saveAlarms() {
	var out = [];
	for(var i in alarms) {
		out.push(alarms[i].data);
	}

	fs.writeFileSync("./alarms.json", JSON.stringify(out, null, 4));

	console.log("Saved alarm data to disk");
}

function createAlarmJob(obj, rule) {
	if(!rule) {
		if(obj.rule) {
			rule = obj.rule;
		} else {
			return null;
		}
	}

	obj.rule = rule;

	console.log("Creating alarm " + obj.data.name + " (" + obj.data.description + ")...");

	var job = schedule.scheduleJob(rule, function(x) {
		console.log("Firing alarm: " + x.data.description);
		playAlarmSound(false, alarm_sounds[Math.floor(Math.random() * 5)]);
	}.bind(null, obj));	

	console.log("Set for " + new Date(job.nextInvocation()).toLocaleString());
	return job;
}

function scheduleAlarm(data) {
	var obj = {
		rule: new schedule.RecurrenceRule(),
		data: data
	};

	var rule = obj.rule;
	rule.dayOfWeek = data.days;
	rule.hour = data.time.hour;
	rule.minute = data.time.minute;

	if(data.enabled) {
		obj.job = createAlarmJob(obj, rule);
	} else {
		console.log("Skipping alarm creation for " + data.name + ", it's disabled...");
	}

	return obj;	
}

function cancelAlarm(alarm) {
	if(alarm.job) {
		alarm.job.cancel();
		console.log("Cancelled " + alarm.data.name);
	} else {
		console.log("Alarm " + alarm.data.name + " isn't enabled/running, skipping cancellation...");
	}
}

function loadAlarms() {
	var len = alarms.length;
	for(var i = 0; i < len; i++) {
		cancelAlarm(alarms[0]);
		alarms.splice(0,1);
	}

	alarm_data = JSON.parse(fs.readFileSync("./alarms.json").toString());

	for(var i in alarm_data) {
		alarms.push(scheduleAlarm(alarm_data[i]));
	}
}
loadAlarms();

function stopAlarm() {
	running = false;
	try {
		audio.kill();

		exec("pactl set-sink-volume 0 66%", {
			PULSE_SERVER: "127.0.0.1"
		});
	} catch(err) { 
		console.log(err);
	}
}

function getClosestAlarm() {
	var invocs = [];
	for(var i in alarms) {
		var alarm_data = alarms[i].data;
		if(alarm_data.enabled) {
			invocs.push(alarms[i].job.nextInvocation());
		}
	}
	invocs.sort(function(a, b) {
		return a - b;
	});

	return alarms.find(function(alarm) {
		if(alarm.data.enabled) {
			return alarm.job.nextInvocation() == invocs[0];
		}
	});
}

function playAlarmSound(self_instance, filename) {
	if(!self_instance) {
		self_instance = false;

		if(running) {
			return;
		} else {
			running = true;

			exec("pactl set-sink-volume 0 100%", {
				PULSE_SERVER: "127.0.0.1"
			});
		}
	} else {
		if(!running) {
			return;
		}
	}

	if(!filename) {
		filename = "alarms/Osmium.ogg";
	}

	console.log("alarm sound: " + filename);

	audio = player.play(filename, function(err) {
		if(err) {
			console.log(err);
		}

		playAlarmSound(true, filename);
	});	
}