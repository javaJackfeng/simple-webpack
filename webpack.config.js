const path = require('path');

const { WebpackRunPlugin, WebpackDonePlugin, loader1, loader2 } = require('./webpack')



const config = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js'
    },
    mode: "development",
    plugins: [new WebpackDonePlugin(), new WebpackRunPlugin()],
    module: {
        rule: [
            {
                test: /\.js$/,
                use: [loader1, loader2]
            }
        ]
    },
    devtool: 'source-map'
};

module.exports = config
