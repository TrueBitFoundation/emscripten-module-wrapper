
var fs = require("fs")
var argv = require('minimist')(process.argv.slice(2))
var execFile = require('child_process').execFile
var ipfsAPI = require('ipfs-api')

const { spawn } = require('child_process');

var path = require('path');

var dir = path.dirname(fs.realpathSync(__filename)) + "/"

var host = "programming-progress.com"

var ipfs = ipfsAPI(host, '5001', {protocol: 'http'})

var tmp_dir = "/tmp/emscripten-module-wrapper" + Math.floor(Math.random() * Math.pow(2,32)).toString(32)

fs.mkdirSync(tmp_dir)

console.log(tmp_dir)

var wasm = dir + "../ocaml-offchain/interpreter/wasm"

var prerun = fs.readFileSync(dir+"pre-run.js")
var preamble = fs.readFileSync(dir+"preamble.js")

function uploadIPFS(fname) {
    return new Promise(function (cont,err) {
        fs.readFile(tmp_dir + "/" + fname, function (err, buf) {
            ipfs.files.add([{content:buf, path:fname}], function (err, res) {
                cont(res[0])
            })
        })
    })
}

function exec(cmd, args, dr) {
    return new Promise(function (cont,err) {
        console.log("exec: ", cmd, args, dr)
        execFile(cmd, args, {cwd:dr || tmp_dir}, function (error, stdout, stderr) {
            if (stderr) console.error('error ', stderr, args)
            if (stdout) console.log('output ', stdout, args)
            if (error) err(error)
            else cont(stdout)
        })
    })
}

function spawnPromise(cmd, args, dr) {
    return new Promise(function (cont,err) {
        console.log("exec: ", cmd + " " + args.join(" "), dr)
        const p = spawn(cmd, args, {cwd:dr || tmp_dir})
        
        p.on('error', (err) => {
            console.log('Failed to start subprocess.');
            err(error)
        });

        p.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        p.stderr.on('data', (data) => {
            console.log(`stderr: ${data}`);
        });

        p.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            cont()
        });

    })
}

function flatten(lst) {
    return [].concat.apply([],lst)
}

function clean(obj, field) {
    var x = obj[field]
    if (typeof x == "object") return
    if (typeof x == "undefined") obj[field] = []
    else obj[field] = [x]
}

async function processTask(fname) {
    var str = fs.readFileSync(fname, "utf8")
    str = str.replace(/{{PRE_RUN_ADDITIONS}}/, prerun)
    str = str.replace(/{{PREAMBLE_ADDITIONS}}/, preamble)
    str = str.replace(/var exports = null;/, "var exports = null; global_info = info;")
    str = str.replace(/buffer\.subarray\(/g, "orig_HEAP8.subarray(")
    str = str.replace(/updateGlobalBufferViews\(\);/, "updateGlobalBufferViews(); addHeapHooks();")
    str = str.replace(/FS.createStandardStreams\(\);/, "FS.createStandardStreams(); FS.mkdir('/working'); FS.mount(NODEFS, { root: '.' }, '/working'); FS.chdir('/working');")
    str = str.replace(/Module\[\"noExitRuntime\"\] = true/, 'Module["noExitRuntime"] = false')
    fs.writeFileSync(tmp_dir + "/prepared.js", 'var source_dir = "' + tmp_dir + '"\n' + str)

    var wasm_file = fname.replace(/.js$/, ".wasm")

    await exec("cp", [wasm_file, tmp_dir + "/" + wasm_file], process.cwd())

    console.log(argv)

    clean(argv, "arg")
    clean(argv, "file")

    console.log(argv)
    for (var i = 0; i < argv.file.length; i++) {
        await exec("cp", [argv.file[i], tmp_dir + "/" + argv.file[i]], process.cwd())
    }

    await exec("node", ["prepared.js"].concat(argv.arg))
    
    for (var i = 0; i < argv.file.length; i++) {
        await exec("cp", [argv.file[i], tmp_dir + "/" + argv.file[i]], process.cwd())
    }

    await exec(wasm, ["-underscore", wasm_file])
    await exec(wasm, ["-merge", "underscore.wasm", dir + "filesystem.wasm"])
    await exec(wasm, ["-add-globals", "globals.json", "merge.wasm"])

    var args = flatten(argv.arg.map(a => ["-arg", a]))
    args = args.concat(flatten(argv.file.map(a => ["-file", a])))
    var result_wasm = "globals.wasm"
    var float_memory = 10*1024

    if (argv.float) {
        await exec(wasm, ["-shift-mem", float_memory, "globals.wasm"])
        await exec(wasm, ["-memory-offset", float_memory, "-int-float", dir + "softfloat.wasm", "shiftmem.wasm"])
        result_wasm = "intfloat.wasm"
        args.push("-memory-offset")
        args.push(float_memory)
    }

    var mem_size = argv["memory-size"] || "25"
    await spawnPromise(wasm, ["-m", "-input", "-file", "record.bin", "-table-size", "20", "-stack-size", "20", "-memory-size", mem_size, "-wasm", result_wasm].concat(args))
    var hash = await uploadIPFS("globals.wasm")
    console.log("Uploaded to IPFS ", hash)
}

argv._.forEach(processTask)

