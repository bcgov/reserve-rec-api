// see README.md for more information on api update configurations.
const DEFAULT_API_UPDATE_CONFIG = {
    fields: {},
    failOnError: true,
    autoTimestamp: false,
    autoVersion: false,
};


//  British Columbia          | -139.06 | 48.30 | -114.03 | 60.00
const BC_BBOX = [
    [-139.06, 48.3], [-114.03, 60]
];

const BC_CENTROID = [
    -126.545, 54.15
];

module.exports = {
    BC_BBOX,
    BC_CENTROID,
    DEFAULT_API_UPDATE_CONFIG,
};
