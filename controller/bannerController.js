const Banner = require('../model/Banner')
const mongoose = require('mongoose')


exports.createBanner = async (req, res) => {
   try {
     const { title, description, links } = req.body;

    const images = req.files?.map(file => ({
        url: file.path,
        public_id: file.filename
    }));

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required"
      });
    }


    const isBannerExists = await Banner.find();

    // if(isBannerExists.length>=1){
    //     return res.json({message: "there's already a banner so update that"})
    // }

    const banner = await new Banner({
        title,
        description,
        links,
        images
    })

    await banner.save()

    res.status(201).json({
        message: "API's are running for banner boss",
        data: banner
    });
   } catch (error) {
    console.log(error)
    res.status(500).json({message: "Server error"})
   }
};


exports.getBanner = async (req,res)=>{
    try{
        const banner = await Banner.find();
        res.status(200).json({
            success: true,
            message: "Banner Fetched Successfully",
            data: banner
        })
    } 
    catch(error){
        console.log(error)
        res.status(500).json({
            success: false,
            message: "Server Error"
        })
    }
}