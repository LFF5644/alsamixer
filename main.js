const child_process=require("child_process");

const alsa={
	card: null,
	commandListenerProcess: null,
	defaultItem: null,
	hasCommandListener: false,
};

//let chunk="";
function handleStdout(buffer){
	//if(global.debug) console.log("rawStdout:",buffer.toString("utf-8"));

	const lines=buffer.toString("utf-8").trim().split("\n").map(item=>item.trim());

	if(global.debug) console.log("chunkedStdout:",lines);
	let entries={
		item: null,
		mute: null,
		volume_db: null,
		volume_number: null,
		volume: null,
		volumeMax_number: null,
	}
	for(const line of lines){
		if(line.startsWith("Simple mixer control '")){ // Simple mixer control 'PCM',0
			entries.item=line.substring(
				22,
				line.substring(22).search("'")+22
			); // PCM
		}
		else if(line.startsWith("Limits: Playback 0 - ")){ // Limits: Playback 0 - 896
			entries.volumeMax_number=Number(line.substring(21)); // 896
		}
		else if(line.startsWith("Front Left: Playback ")){ // Front Left: Playback 448 [50%] [-36.00dB] [on]
			let items=line.substring(21).split(" "); // [ "448", "[50%]", "[-36.00dB]", "[on]" ]
			entries={
				...entries,
				volume_number: Number(items[0]), // 448
				volume: Number(items[1].substring(1,items[1].length-2)), // 50
				volume_db: Number(items[2].substring(1,items[2].length-3)), // -36
				mute: items[3]==="[off]", // false
			};
		}
	}
	if(global.debug) console.log(entries);
	executeEvent("volumeChange",entries);
	return entries;

}

function createCommandListener(){
	//if(alsa.hasCommandListener) throw new Error("commandListener already exist/running!");
	if(alsa.hasCommandListener) alsa.commandListenerProcess.kill();
	if(global.debug) console.log("starting commandListener...");

	alsa.hasCommandListener=true;
	alsa.commandListenerProcess=child_process.spawn("/usr/bin/amixer",[
		"--stdin",
		"--card",
		String(alsa.card),
	]);

	alsa.commandListenerProcess.on("exit",(code,int)=>{
		if(global.debug) console.log("commandListenerProcess Exit:",code,int);
		alsa.hasCommandListener=false;
	});
}

function volumeAction(action,volume,item=alsa.defaultItem,card=alsa.card){
	if(isNaN(volume)||!item||isNaN(card)) throw new Error("volumeAction arguments are: action[String] (set, adjust), volume[Number] (in Percent), item[String] (default is 'Master')");

	if(alsa.hasCommandListener&&card===alsa.card){
		const cmd=`sset "${item}" ${volume<0?volume*-1:volume}%${action==="adjust"?(volume<0?"-":"+"):""}\n`;
		alsa.commandListenerProcess.stdin.write(cmd);
		getVolume();
	}
	else{
		child_process.exec(`/usr/bin/amixer --card ${card} sset "${item}" ${volume<0?volume*-1:volume}%${action==="adjust"?(volume<0?"-":"+"):""}`,(err,stdout,stderr)=>{
			if(err||stderr) throw new Error(err,stderr); // error in child process exec!
			handleStdout(stdout);
		});
		
	}
}
function getVolume(item=alsa.defaultItem,card=alsa.card){
	if(!item||isNaN(card)) throw new Error("getVolume arguments are: item[String] (default is 'Master')");

	return new Promise(resolve=>{
		child_process.exec(`/usr/bin/amixer --card ${card} sget "${item}"`,(err,stdout,stderr)=>{
			if(err||stderr) throw new Error(err,stderr); // error in child process exec!
			const result=handleStdout(stdout);
			resolve(result);
			return;
		});
	});
}

let events={
	"*": [
		global.debug?console.log:()=>{},
	],
	volumeChange: [],
}
function addEvent(event,callback){
	events={
		...events,
		[event]: events.event?[
			...events.event,
			callback,
		]:[callback],
	}
}

function executeEvent(event,result){
	if(!events[event]) throw new Error("event not exist!");
	const cbs=[
		...events["*"],
		...events[event],
	];

	for(const callback of cbs){
		callback(event,result);
	}
}
function close(){
	if(alsa.hasCommandListener) alsa.commandListenerProcess.kill();
}

module.exports=({
	card=0,
	debug=false,
	defaultItem="Master",
	spawnCommandListener=false,
})=>{
	if(debug||process.env.DEBUG||process.env.debug||process.argv.includes("--debug")){
		console.log("SET DEBUG MODE FOR ALSAMIXER.JS!");
		global.debug=true;
	}
	if(isNaN(Number(card))) throw new Error("card must be an Number!");
	alsa.card=Number(card);
	alsa.defaultItem=defaultItem;

	if(spawnCommandListener) createCommandListener();

	return{
		adjustVolume: (...args)=>volumeAction("adjust",...args),
		close,
		getVolume,
		on: addEvent,
		setVolume: (...args)=>volumeAction("set",...args),
	};

};
