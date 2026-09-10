import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export async function patchEmbindForCSP() {
  const filesToPatch = [
    {
      filePath: path.resolve(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'),
      isWorker: false,
    },
    {
      filePath: path.resolve(root, 'node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js'),
      isWorker: true,
    },
  ];

  for (const { filePath, isWorker } of filesToPatch) {
    try {
      let content = await fs.readFile(filePath, 'utf8');
      let modified = false;

      // 1. Patch createNamedFunction
      const cnfRegex = /function createNamedFunction\(name,\s*body\)\s*\{[\s\S]*?return new Function\([\s\S]*?\)\(body\);?\s*\}/;
      if (cnfRegex.test(content)) {
        content = content.replace(
          cnfRegex,
          'function createNamedFunction(name, body) { var fn = function() { return body.apply(this, arguments); }; try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch (e) {} return fn; }'
        );
        modified = true;
      }

      // 2. Patch embind__requireFunction
      const reqFnRegex = /return new Function\(\s*["']dynCall["'],\s*["']rawFunction["'],\s*body\s*\)\s*\(\s*dynCall,\s*rawFunction\s*\);?/;
      if (reqFnRegex.test(content)) {
        content = content.replace(
          reqFnRegex,
          'return function() { return dynCall.apply(null, [rawFunction].concat(Array.prototype.slice.call(arguments))); };'
        );
        modified = true;
      }

      // 3. Patch craftInvokerFunction
      const craftStart = content.indexOf('function craftInvokerFunction(');
      if (craftStart !== -1) {
        const retInvoker = content.indexOf('return invokerFunction', craftStart);
        if (retInvoker !== -1) {
          const end = content.indexOf('}', retInvoker) + 1;
          const replacement = `function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
  var argCount = argTypes.length;
  if (argCount < 2) {
    throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  }
  var isClassMethodFunc = argTypes[1] !== null && classType !== null;
  var needsDestructorStack = false;
  for (var i = 1; i < argTypes.length; ++i) {
    if (argTypes[i] !== null && (argTypes[i].destructorFunction === void 0 || argTypes[i].destructorFunction === undefined)) {
      needsDestructorStack = true;
      break;
    }
  }
  var returns = argTypes[0].name !== "void";
  var expectedArgs = argCount - 2;

  var invoker = function() {
    if (arguments.length !== expectedArgs) {
      throwBindingError("function " + humanName + " called with " + arguments.length + " arguments, expected " + expectedArgs + " args!");
    }
    var destructors = needsDestructorStack ? [] : null;
    var dtorStack = destructors;
    var wiredArgs = [cppTargetFunc];
    if (isClassMethodFunc) {
      wiredArgs.push(argTypes[1].toWireType(dtorStack, this));
    }
    for (var i = 0; i < expectedArgs; ++i) {
      wiredArgs.push(argTypes[i + 2].toWireType(dtorStack, arguments[i]));
    }
    var rv = cppInvokerFunc.apply(null, wiredArgs);
    if (needsDestructorStack) {
      runDestructors(destructors);
    } else {
      var startIdx = isClassMethodFunc ? 1 : 2;
      for (var i = startIdx; i < argTypes.length; ++i) {
        if (argTypes[i].destructorFunction !== null) {
          var wiredVal = wiredArgs[isClassMethodFunc ? i : i - 1];
          argTypes[i].destructorFunction(wiredVal);
        }
      }
    }
    if (returns) {
      return argTypes[0].fromWireType(rv);
    }
  };
  try {
    Object.defineProperty(invoker, "name", { value: humanName, configurable: true });
  } catch (e) {}
  return invoker;
}`;
          content = content.slice(0, craftStart) + replacement + content.slice(end);
          modified = true;
        }
      }

      // 4. Patch __emval_get_method_caller
      const methodStart = content.indexOf('function __emval_get_method_caller(');
      if (methodStart !== -1) {
        const retMethod = content.indexOf('return __emval_addMethodCaller(invokerFunction', methodStart);
        if (retMethod !== -1) {
          const end = content.indexOf('}', retMethod) + 1;
          const replacement = `function __emval_get_method_caller(argCount, argTypes) {
  var types = __emval_lookupTypes(argCount, argTypes);
  var retType = types[0];
  var signatureName = retType.name + "_$" + types.slice(1).map(function(t) { return t.name; }).join("_") + "$";
  var functionName = makeLegalFunctionName("methodCaller_" + signatureName);
  var invokerFunction = function(handle, name, destructors, args) {
    var offset = 0;
    var callArgs = [];
    for (var i = 0; i < argCount - 1; ++i) {
      var arg = types[1 + i].readValueFromPointer(args + (offset ? offset : 0));
      offset += types[1 + i]["argPackAdvance"];
      callArgs.push(arg);
    }
    var rv = handle[name].apply(handle, callArgs);
    for (var i = 0; i < argCount - 1; ++i) {
      if (types[1 + i]["deleteObject"]) {
        types[1 + i].deleteObject(callArgs[i]);
      }
    }
    if (!retType.isVoid) {
      return retType.toWireType(destructors, rv);
    }
  };
  try { Object.defineProperty(invokerFunction, "name", { value: functionName, configurable: true }); } catch (e) {}
  return __emval_addMethodCaller(invokerFunction);
}`;
          content = content.slice(0, methodStart) + replacement + content.slice(end);
          modified = true;
        }
      }

      // 5. Patch jp in worker
      if (isWorker) {
        const jpStart = content.indexOf('function jp(');
        if (jpStart !== -1) {
          const end = content.indexOf('function Zp(', jpStart);
          if (end !== -1) {
            const replacement = `function jp(a, l, h) {
    var [f, ..._] = Fp(a, l >>> 0);
    l = f.Xc.bind(f);
    var C = _.map((G) => G.Wc.bind(G));
    var invoker = function(handle, methodName, destructorsRef, args) {
      var callArgs = C.map((getter, idx) => getter(args + (idx ? 8 * idx : 0)));
      var target = Ge(handle);
      var rv;
      switch (h) {
        case 0:
          rv = target(...callArgs);
          break;
        case 1:
          rv = target[yr(methodName)](...callArgs);
          break;
        case 2:
          rv = new target(...callArgs);
          break;
        case 3:
          rv = callArgs[0](...callArgs.slice(1));
          break;
      }
      if (!f.Cd) {
        return qp(l, destructorsRef, rv);
      }
    };
    var name = "methodCaller<(" + _.map(function(G) { return G.name; }).join(",") + ") => " + f.name + ">";
    return Hp(Object.defineProperty(invoker, "name", { value: name }));
  }
  `;
            content = content.slice(0, jpStart) + replacement + content.slice(end);
            modified = true;
          }
        }
      }

      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`Successfully patched Embind in: ${path.relative(root, filePath)}`);
      }
    } catch (err) {
      console.warn(`Error patching ${filePath}:`, err.message);
    }
  }
}

export async function postProcessDistForCSP() {
  const distDir = path.resolve(root, 'dist');
  try {
    const files = [];
    async function collect(dir) {
      for (const item of await fs.readdir(dir)) {
        const full = path.join(dir, item);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) await collect(full);
        else if (full.endsWith('.js')) files.push(full);
      }
    }
    await collect(distDir);

    const emvalMethodCallerRegex = /,\s*(\w+)\s*=\s*new\s+Function\(Object\.keys\((\w+)\),\s*(\w+)\)\(\.\.\.Object\.values\(\2\)\)/g;

    for (const file of files) {
      let content = await fs.readFile(file, 'utf8');
      let modified = false;

      if (emvalMethodCallerRegex.test(content)) {
        content = content.replace(
          emvalMethodCallerRegex,
          (match, fnVar, paramDict) => {
            return `, ${fnVar} = function(handle, methodName, destructorsRef, args) {
              var callArgs = [];
              var i = 0;
              while (${paramDict}["argFromPtr" + i]) {
                callArgs.push(${paramDict}["argFromPtr" + i](args + (i ? 8 * i : 0)));
                i++;
              }
              var target = ${paramDict}.toValue ? ${paramDict}.toValue(handle) : handle;
              var rv;
              if (${paramDict}.getStringOrSymbol && methodName !== undefined) {
                rv = target[${paramDict}.getStringOrSymbol(methodName)](...callArgs);
              } else if (typeof target === "function") {
                rv = target(...callArgs);
              } else {
                rv = new target(...callArgs);
              }
              if (${paramDict}.emval_returnValue) {
                return ${paramDict}.emval_returnValue(${paramDict}.toReturnWire, destructorsRef, rv);
              }
              return rv;
            }`;
          }
        );
        modified = true;
      }

      if (modified) {
        await fs.writeFile(file, content, 'utf8');
        console.log(`Post-processed for CSP compliance: ${path.relative(root, file)}`);
      }
    }
  } catch (err) {
    console.warn('Post-processing error:', err.message);
  }
}

// If run directly
if (process.argv[1] && process.argv[1].includes('patch-csp')) {
  await patchEmbindForCSP();
  await postProcessDistForCSP();
}
