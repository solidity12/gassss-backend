module.exports = {
    apps: [{
        name: "gasssss-collector-prod",
        script: "src/index.js",

        max_size: "10M",
        retain: 5,
        compress: true,
        out_file: "./logs/prod-out.log",
        error_file: "./logs/prod-error.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss",

        env: {
            NODE_ENV: "prod"
        }
    }]
};
