const Banner = require('../model/Banner')
const mongoose = require('mongoose')


exports.createBanner = async (req, res) => {
   try {
     const { title, description, links, subTitle, bannerLayout, buttonText, buttonLink, buttonPosition } = req.body;

    const image = req.file ? req.file.path : null;


    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required"
      });
    }


    const isBannerExists = await Banner.find();

    //check if banner already exists with this title
    const existingBanner = await Banner.findOne({ title });
    if (existingBanner) {
        return res.json({ success: false, message: "Banner with this title already exists" });
    }

    // if(isBannerExists.length>=1){
    //     return res.json({message: "there's already a banner so update that"})
    // }

    const banner = await new Banner({
        title,
        description,
        links,
        image,
        subTitle,
        bannerLayout,
        buttonText,
        buttonLink,
        buttonPosition,
        status: 'Active'
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

exports.getBannerById = async (req,res)=>{
    try{
        const id = req.params.id
        const banner =  await Banner.findById(id);
        if(!banner){
            return res.json({success: false, message: "There's not any banner of this id"})
        }
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

exports.updateBanner = async (req,res)=>{
    try {
        const id = req.params.id
        const isBanner = await Banner.findById(id)
        
        if(!isBanner){
            return res.json({success: false, message: "There's not any banner of this id"})
        }

        const existingBanner = await Banner.findOne({ title: req.body.title });
        if (existingBanner && existingBanner._id.toString() !== id) {
            return res.json({ success: false, message: "Banner with this title already exists" });
        }

        const banner = await Banner.findByIdAndUpdate(id,
            req.body,
            {new: true}
        )
        res.json({success: true, message: "Banner Updated successfully", data: banner})
    } catch (error) {
        
    }
}

exports.deleteBanner = async (req,res)=>{
    try {
        const id = req.params.id
        const isBanner = await Banner.findById(id)
        
        if(!isBanner){
            return res.json({success: false, message: "There's not any banner of this id"})
        }
        await Banner.findByIdAndDelete(id)
        res.json({success: true, message: "Banner Deleted successfully"})
    } catch (error) {
        console.log(error)
        res.status(500).json({
            success: false,
            message: "Server Error"
        })
    }
}