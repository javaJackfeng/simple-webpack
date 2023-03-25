const { SyncHook } = require("tapable")
const path = require('path')
const fs = require('fs')
const parser = require('@babel/parser')
let types = require('@babel/types')
const traverse = require('@babel/traverse').default
const generator = require('@babel/generator').default


function getSource(chunk) {
    return `(() => {
        var modules = {
            ${chunk.modules.map((module) => `"${module.id}": (module) => {${module._source}}`)}
        }
        var cache = {}
        function require(moduleId) {
            var cachedModule = cache[moduleId]
            if (cachedModule !== undefined) {
                return cachedModule.exports
            }
            var module = cache[moduleId] = {
                exports: {}
            }
            modules[moduleId](module, module.exports, require)
            return module.exports
        }
        var exports = {}
        ${chunk.entryModule._source}
    })()`
}

function tryExtension(modulePath, extensions = []) {
    if (fs.existsSync(modulePath)) {
        return modulePath
    }
    for (let i = 0; i < extensions?.length; i++) {
        let filePath = `${modulePath}${extensions[i]}`
        if (fs.existsSync(filePath)) {
            return filePath
        }
    }

    throw new Error(`无法找到${modulePath}`)
}

const toUnixPath = (filename) => {
    return filename.replace(/\\/g, '/')
}

const baseDir = toUnixPath(process.cwd())


class WebpackRunPlugin {
    apply(compiler) {
        compiler.hooks.run.tap('webpackRunPlugin', () => {
            console.log("开始编译")
        })
    }
}

class WebpackDonePlugin {
    apply(compiler) {
        compiler.hooks.done.tap("webpackDonePlugin", () => {
            console.log("编译完成")
        })
    }
}

const loader1 = (source) => {
    return source + '/** 加上注释： loader1 */'
}

const loader2 = (source) => {
    return source + '/** 加上注释： loader2  */'
}



class Compilation {
    constructor(webpackOptions) {
        this.options = webpackOptions
        this.modules = []
        this.chunks = []
        this.assets = []
        this.fileDependencies = []
    }


    buildModule(name, modulePath) {
        let sourceCode = fs.readFileSync(modulePath, 'utf-8')
        let moduleId = './' + path.posix.relative(baseDir, modulePath)
        let module = {
            id: moduleId,
            names: [name],
            dependencies: [],
            _source: ""
        }
        let loaders = []
        let { rules = [] } = this.options.module
        rules.forEach((rule) => {
            let { test } = rule
            if (modulePath.match(test)) {
                loaders.push(...rule.use)
            }
        })
        sourceCode = loaders.reduceRight((code, loader) => {
            return loader(code)
        }, sourceCode)

        let ast = parser.parse(sourceCode, { sourceType: 'module' })
        traverse(ast, {
            CallExpression: (nodePath) => {
                const { node } = nodePath
                if (node.callee.name === 'require') {
                    let depModuleName = node.arguments[0].value
                    let dirname = path.posix.dirname(modulePath)
                    let depModulePath = path.posix.join(dirname, depModuleName)
                    let extensions = this.options.resolve?.extensions || ['./js']
                    depModulePath = tryExtension(depModulePath, extensions)
                    this.fileDependencies.push(depModulePath)
                    let depModuleId = "./" + path.posix.relative(baseDir, depModulePath)
                    node.arguments = [types.stringLiteral(depModuleId)]
                    module.dependencies.push({ depModuleId, depModulePath })
                }
            }
        })
        let { code } = generator(ast)
        module._source = code
        module.dependencies.forEach(({ depModuleId, depModulePath }) => {
            let existsModule = this.modules.find(({ id }) => id === depModuleId)
            if (existsModule) {
                existsModule.names.push(name)   
            } else {
                let depModule = this.buildModule(name, depModulePath)
                this.modules.push(depModule)
            }
        })
        return module
    }

    build(callback) {
        let entry = {}
        if (typeof this.options.entry === 'string') {
            entry.main = this.options.entry
        } else {
            entry = this.options.entry
        }

        for (let entryName in entry) {
            let entryFilePath = path.posix.join(baseDir, entry[entryName])
            this.fileDependencies.push(entryFilePath)
            let entryModule = this.buildModule(entryName, entryFilePath)
            this.modules.push(entryModule)

            let chunk = {
                name: entryName,
                entryModule,
                modules: this.modules.filter((module) => module.names.includes(entryName)),
            }
            this.chunks.push(chunk)
        }

        this.chunks.forEach((chunk) => {
            let filename = this.options.output.filename.replace('[name]', chunk.name)
            this.assets[filename] = getSource(chunk)
        })

        callback(null, {
            chunks: this.chunks,
            modules: this.modules,
            assets: this.assets
        }, this.fileDependencies)
    }
}

class Compiler {
    constructor(webpackOptions) {
        this.options = webpackOptions
        this.hooks = {
            run: new SyncHook(),
            done: new SyncHook()
        }
    }

    compile(callback) {
        const compilation = new Compilation(this.options)
        compilation.build(callback)
    }

    run(callback) {
        this.hooks.run.call()
        const onCompiled = (err, stats, fileDependencies) => {
            for (let filename in stats.assets) {
                let filePath = path.join(this.options.output.path, filename)
                if (!fs.existsSync(this.options.output.path)) {
                    fs.mkdirSync(this.options.output.path)
                }
                fs.writeFileSync(filePath, stats.assets[filename], 'utf-8')
            }
            callback(err, {
                toJson: () => stats
            })
            this.hooks.done.call()
        }
        this.compile(onCompiled)
    }
}

const webpack = (webpackOptions) => {
    const compiler = new Compiler(webpackOptions)
    const { plugins } = webpackOptions
    for (let plugin of plugins) {
        plugin.apply(compiler)
    }
    return compiler
}


module.exports = {
    webpack,
    WebpackRunPlugin,
    WebpackDonePlugin,
    loader1,
    loader2
}