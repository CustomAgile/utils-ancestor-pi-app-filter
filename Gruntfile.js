module.exports = function (grunt) {
    require('grunt');

    grunt.initConfig({
        concat: {
            options: {},
            dist: {
                src: [
                    "src/overrides.js",
                    "src/toggle-button.js",
                    "src/tutorial.js",
                    "src/filter-plugin.js"
                ],
                dest: 'index.js',
            },
        },
    });

    grunt.loadNpmTasks('grunt-contrib-concat');
};