// Brand Controller CRUD (updated: controllers/brandController.js)
const Brand = require('../model/Brand'); // Adjust path as needed
const mongoose = require('mongoose');
const fs = require('fs'); // For image handling if needed

// Create Brand
exports.createBrand = async (req, res) => {
  const { brandCode, brandName, description, status = 'Active' } = req.body;
  const image = req.file ? req.file.path : null;

  // Validation
  if (!brandCode) {
    return res.status(400).json({ success: false, msg: 'Brand code is required' });
  }
  if (!brandName) {
    return res.status(400).json({ success: false, msg: 'Brand brandName is required' });
  }
  if (!image) {
    return res.status(400).json({ success: false, msg: 'Please select a brand logo/image' });
  }
  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    // Check for existing brand by code or brandName
    const existingByCode = await Brand.findOne({ brandCode });
    if (existingByCode) {
      return res.status(400).json({ success: false, msg: 'Brand with this code already exists' });
    }
    const existingBybrandName = await Brand.findOne({ brandName });
    if (existingBybrandName) {
      return res.status(400).json({ success: false, msg: 'Brand with this brandName already exists' });
    }

    const brandData = {
      brandCode,
      brandName,
      status,
      image,
      createdAt: new Date().toISOString(), // String format as per schema
      updatedAt: new Date().toISOString()
    };
    if (description) brandData.description = description;

    const newBrand = new Brand(brandData);
    await newBrand.save();

    res.status(201).json({ 
      success: true,
      msg: 'Brand created successfully',
      brand: newBrand 
    });
  } catch (err) {
    console.error('Brand creation error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, msg: 'Server error during brand creation' });
  }
};

// Get All Brands
exports.getAllBrands = async (req, res) => {
  const { page = 1, limit = 10, status, brandName, brandCode } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
  if (brandCode) filter.brandCode = { $regex: brandCode, $options: 'i' };

  try {
    const brands = await Brand.find(filter)
      .limit(parseInt(limit))
      .skip((page - 1) * parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Brand.countDocuments(filter);

    res.json({ 
      success: true,
      brands, 
      total, 
      pages: Math.ceil(total / limit),
      currentPage: page 
    });
  } catch (err) {
    console.error('Brand list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching brands' });
  }
};

// Get Brand by ID
exports.getBrandById = async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    if (!brand) {
      return res.status(404).json({ success: false, msg: 'Brand not found' });
    }
    res.json({ success: true, brand });
  } catch (err) {
    console.error('Brand get error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching brand' });
  }
};

// Update Brand
exports.updateBrand = async (req, res) => {
  const { brandCode, brandName, description, status } = req.body;
  const image = req.file ? req.file.path : null;

  if (status !== undefined && !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid brand ID format' });
    }

    const currentBrand = await Brand.findById(req.params.id);
    if (!currentBrand) {
      return res.status(404).json({ success: false, msg: 'Brand not found' });
    }

    const updateData = { updatedAt: new Date().toISOString() };
    let existingCheck = currentBrand;

    if (brandCode !== undefined) {
      if (brandCode === currentBrand.brandCode) {
        updateData.brandCode = brandCode;
      } else {
        const existingByCode = await Brand.findOne({ brandCode });
        if (existingByCode) {
          return res.status(400).json({ success: false, msg: 'Brand with this code already exists' });
        }
        updateData.brandCode = brandCode;
      }
    }

    if (brandName !== undefined) {
      if (brandName === currentBrand.brandName) {
        updateData.brandName = brandName;
      } else {
        const existingBybrandName = await Brand.findOne({ brandName });
        if (existingBybrandName) {
          return res.status(400).json({ success: false, msg: 'Brand with this brandName already exists' });
        }
        updateData.brandName = brandName;
      }
    }

    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (image !== null) updateData.image = image;

    if (Object.keys(updateData).length === 1) { // Only updatedAt
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    const brand = await Brand.findByIdAndUpdate(
      req.params.id, 
      updateData, 
      { new: true, runValidators: true }
    );

    // Optional: Delete old image if new one uploaded
    if (image && currentBrand.image && currentBrand.image !== image) {
      if (fs.existsSync(currentBrand.image)) {
        fs.unlinkSync(currentBrand.image);
      }
    }

    res.json({ 
      success: true,
      msg: 'Brand updated successfully',
      brand 
    });
  } catch (err) {
    console.error('Brand update error details:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (err.brandName === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${err.message}` });
    }
    if (err.brandName === 'CastError') {
      return res.status(400).json({ success: false, msg: 'Invalid ID format' });
    }
    res.status(500).json({ success: false, msg: 'Server error updating brand' });
  }
};

// Delete Brand
exports.deleteBrand = async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    if (!brand) {
      return res.status(404).json({ success: false, msg: 'Brand not found' });
    }

    // Optional: Delete image file
    if (brand.image && fs.existsSync(brand.image)) {
      fs.unlinkSync(brand.image);
    }

    await Brand.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Brand deleted successfully' });
  } catch (err) {
    console.error('Brand delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting brand' });
  }
};