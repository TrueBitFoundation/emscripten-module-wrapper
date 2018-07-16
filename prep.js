const fs = require('fs-extra');
let argv = require('minimist')(process.argv.slice(2));
// const ipfsAPI = require('ipfs-api')
const { spawn, execFile } = require('child_process');
const path = require('path');

var dir = path.dirname(fs.realpathSync(__filename)) + '/';

// var host = argv["ipfs-host"] || "localhost"

// var ipfs = ipfsAPI(host, '5001', {protocol: 'http'})

console.log(argv);

// console.log('kill')
// process.exit(1337)

var tmp_dir = path.resolve(process.cwd(), argv.out);
// __dirname +
// '/emscripten-module-wrapper' +
// Math.floor(Math.random() * Math.pow(2, 32)).toString(32);

fs.mkdirSync(tmp_dir);
// fix pathing so we don't need to worry about what dir we are in.
const fixPaths = (targetDir, relativePathsArray) => {
  return relativePathsArray.map(filePath => {
    let start = path.resolve(process.cwd(), filePath);
    let localPath = filePath.replace('/src/', '/');
    let end = path.resolve(targetDir, localPath);
    fs.copySync(start, end);
    return localPath;
  });
};

const localizeArgv = argv => {
  console.log('before: ', argv);
  //   move module
  argv._.push(argv._[0].replace(/.js$/, '.wasm'));
  fixPaths(tmp_dir, argv._);
  argv._ = [fixPaths(__dirname, argv._)[0]];

  // move files
  fixPaths(tmp_dir, argv.file);
  argv.file = fixPaths(__dirname, argv.file);

  console.log('after: ', argv);
  return argv;
};

argv = localizeArgv(argv);

var config = [];

function readConfig() {
  try {
    config = JSON.parse(
      fs.readFileSync(dir + '../webasm-solidity/node/config.json')
    );
  } catch (e) {}
}

readConfig();

var wasm = dir + '../ocaml-offchain/interpreter/wasm';

var prerun = fs.readFileSync(dir + 'pre-run.js');
var preamble = fs.readFileSync(dir + 'preamble.js');

function exec(cmd, args) {
  return new Promise(function(cont, err) {
    // console.log('exec: ', cmd, args, dr);
    execFile(cmd, args, { cwd: tmp_dir }, function(error, stdout, stderr) {
      if (stderr) console.error('error ', stderr, args);
      if (stdout) console.log('output ', stdout, args);
      if (error) console.error('error ', error);
      cont(stdout);
    });
  });
}

function spawnPromise(cmd, args) {
  // console.log(cmd, dr, tmp_dir)
  return new Promise(function(cont, err) {
    // console.log(cont, err)
    console.log('exec: ', cmd + ' ' + args.join(' '));
    var res = '';
    const p = spawn(cmd, args, { cwd: tmp_dir });

    p.on('error', err => {
      console.log('Failed to start subprocess.');
      err(error);
    });

    p.stdout.on('data', data => {
      res += data;
      console.log(`stdout: ${data}`);
    });

    p.stderr.on('data', data => {
      console.log(`stderr: ${data}`);
    });

    p.on('close', code => {
      console.log(`child process exited with code ${code}`);
      cont(res);
    });
  });
}

function flatten(lst) {
  return [].concat.apply([], lst);
}

function clean(obj, field) {
  var x = obj[field];
  if (typeof x == 'object') return;
  if (typeof x == 'undefined') obj[field] = [];
  else obj[field] = [x];
}

async function processTask(fname) {
  // console.log(fname)

  var str = fs.readFileSync(path.resolve(tmp_dir, fname), 'utf8');
  str = str.replace(/{{PRE_RUN_ADDITIONS}}/, prerun);

  if (argv.asmjs) preamble += '\nvar save_stack_top = false;';
  else preamble += '\nvar save_stack_top = true;';

  // preamble += "\nvar save_stack_top = true;"

  str = str.replace(/{{PREAMBLE_ADDITIONS}}/, preamble);
  str = str.replace(
    /var exports = null;/,
    'var exports = null; global_info = info;'
  );
  str = str.replace(/buffer\.subarray\(/g, 'orig_HEAP8.subarray(');
  str = str.replace(
    /updateGlobalBufferViews\(\);/,
    'updateGlobalBufferViews(); addHeapHooks();'
  );
  str = str.replace(
    /FS.createStandardStreams\(\);/,
    "FS.createStandardStreams(); FS.mkdir('/working'); FS.mount(NODEFS, { root: '.' }, '/working'); FS.chdir('/working');"
  );
  str = str.replace(
    /Module\[\"noExitRuntime\"\] = true/,
    'Module["noExitRuntime"] = false'
  );
  fs.writeFileSync(
    tmp_dir + '/prepared.js',
    'var source_dir = "' + tmp_dir + '"\n' + str
  );

  var wasm_file = fname.replace(/.js$/, '.wasm');

  await exec('cp', [wasm_file, tmp_dir + '/' + wasm_file]);

  //   console.log(argv);

  clean(argv, 'arg');
  clean(argv, 'file');

  //   console.log(argv);

  if (argv.analyze) {
    for (var i = 0; i < argv.file.length; i++) {
      await exec('cp', [argv.file[i], tmp_dir + '/' + argv.file[i]]);
    }
    await exec('node', ['prepared.js'].concat(argv.arg));
    // return
  }

  for (var i = 0; i < argv.file.length; i++) {
    await exec('cp', [argv.file[i], tmp_dir + '/' + argv.file[i]]);
  }

  if (argv.asmjs)
    await exec(wasm, ['-merge', wasm_file, dir + 'filesystem.wasm']);
  else {
    await exec(wasm, ['-underscore', wasm_file]);
    await exec(wasm, [
      '-merge',
      'underscore.wasm',
      dir + 'filesystem-wasm.wasm'
    ]);
  }
  if (argv.analyze)
    await exec(wasm, ['-add-globals', 'globals.json', 'merge.wasm']);
  else if (argv.asmjs)
    await exec(wasm, [
      '-add-globals',
      dir + 'globals-asmjs.json',
      'merge.wasm'
    ]);
  else await exec(wasm, ['-add-globals', dir + 'globals.json', 'merge.wasm']);

  var args = flatten(argv.arg.map(a => ['-arg', a]));
  args = args.concat(flatten(argv.file.map(a => ['-file', a])));
  if (config.interpreter_args) args = args.concat(config.interpreter_args);
  if (argv.asmjs) args.push('-asmjs');
  var result_wasm = 'globals.wasm';
  var float_memory = 10 * 1024;

  if (argv.float) {
    await exec(wasm, ['-shift-mem', float_memory, 'globals.wasm']);
    await exec(wasm, [
      '-memory-offset',
      float_memory,
      '-int-float',
      dir + 'softfloat.wasm',
      'shiftmem.wasm'
    ]);
    result_wasm = 'intfloat.wasm';
    args.push('-memory-offset');
    args.push(float_memory);
  }

  if (argv.metering) {
    var dta = fs.readFileSync(tmp_dir + '/' + result_wasm);
    const metering = require('wasm-metering');
    const meteredWasm = metering.meterWASM(dta, {
      moduleStr: 'env',
      fieldStr: 'usegas',
      meterType: 'i64'
    });
    result_wasm = 'metered.wasm';
    var dta = fs.writeFileSync(tmp_dir + '/' + result_wasm, meteredWasm);
  }

  var mem_size = argv['memory-size'] || '25';
  var info = await spawnPromise(
    wasm,
    [
      '-m',
      '-input',
      '-table-size',
      '20',
      '-stack-size',
      '20',
      '-memory-size',
      mem_size,
      '-wasm',
      result_wasm
    ].concat(args)
  );
  if (argv.run)
    await spawnPromise(
      wasm,
      [
        '-m',
        '-table-size',
        '20',
        '-stack-size',
        '20',
        '-memory-size',
        mem_size,
        '-wasm',
        result_wasm
      ].concat(args)
    );

  console.log(info);

  // var hash = await uploadIPFS("globals.wasm")

  // console.log("cd", tmp_dir)
  // console.log("Uploaded to IPFS ", hash)
  // fs.writeFileSync("info.json", JSON.stringify({ipfshash: hash.hash, codehash: JSON.parse(info).vm.code, memsize:mem_size}))
}

argv._.forEach(processTask);
