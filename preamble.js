
var global_info;

// Here we should add the function that will add hooks to record the memory usage

function makeWrapper(view) {
    /* var obj = {
        get [idx]() {
           console.log("trying to access")
    }
    } */
    return new Proxy(view, {
        get: function(target, name) {
            // console.log("Getting ", name)
            return target[name]
        },
        set: function(target, name, value) {
            // console.log("Setting ", name)
            target[name] = value
        }
    })
}

function addHeapHooks() {
    // console.log(HEAP8[0])
    HEAP8 = makeWrapper(HEAP8)
    HEAP16 = makeWrapper(HEAP16)
    HEAP32 = makeWrapper(HEAP32)
}
