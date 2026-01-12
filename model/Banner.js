const mongoose = require('mongoose')

const bannerSchema = mongoose.Schema({
    title: {
        type: String
    },
    subTitle: {
        type: String
    },
    bannerLayout: {
        type: String
    },
    buttonText: {
        type: String
    },
    buttonLink: {
        type: String
    },
    buttonPosition: {
        type: String
    },
    description: {
        type: String
    },
    images: [
        {
            url: { type: String, required: true },
            public_id: { type: String, required: true }
        }
    ],
    links: {
        type: [String]
    },
    status: {
        type: Boolean,
        default: true
    }
}, { timestamps: true })

const Banner = mongoose.model('Banner', bannerSchema)

module.exports = Banner