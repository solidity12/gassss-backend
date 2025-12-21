module.exports = {
    apps: [{
        name: "gasssss-collector",
        script: "src/index.js",
        max_size: "10M",
        retain: 5,
        compress: true,
        out_file: "./logs/gasssss-collector-out.log",
        error_file: "./logs/gasssss-collector-error.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss"
    }]
}
