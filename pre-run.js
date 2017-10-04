
// {{PRE_RUN_ADDITIONS}}

/*
console.log(Module)

for (i in Module) {
    if (typeof Module[i] == "number") console.log(i + ": " + Module[i])
    else console.log(i + ": " + typeof Module[i])
    // Find out which of there are globals
}
*/

var env_globals = {}

var calls = []

function makeStub(name, func) {
    return function () {
        console.log("Calling ", name, arguments)
        var res = func.apply(null, arguments)
        calls.push({result: res, args:Array.from(arguments), name:name})
        console.log("Result", res)
        return res
    }
}

for (i in global_info.env) {
    if (typeof global_info.env[i] == "number") {
        console.log(i + ": " + global_info.env[i])
        env_globals[i] = global_info.env[i]
    }
    else {
        console.log(i + ": " + typeof global_info.env[i])
        if (typeof global_info.env[i] == "function") global_info.env[i] = makeStub(i, global_info.env[i])
    }
    // Find out which of there are globals
}

// console.log(global_info)

console.log(JSON.stringify(env_globals))

