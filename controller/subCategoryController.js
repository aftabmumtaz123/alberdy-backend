const Category = require('../model/Category'); 
const Subcategory = require('../model/subCategory');
const mongoose = require('mongoose');
const fs = require('fs');

// Helper for flexible category lookup
const findCategoryByIdOrName = async (categoryValue) => {
  if (!categoryValue) return null;
  if (mongoose.Types.ObjectId.isValid(categoryValue)) {
    return await Category.findById(categoryValue);
  }
  return await Category.findOne({ name: categoryValue, status: 'Active' });
};

exports.createSubcategory = async (req, res) => {
  const { name, parent_category_id: categoryValue, status = 'Active' } = req.body;
  const image = req.file ? req.file.path : null;

  // if (!name || !categoryValue) {
  //   return res.status(400).json({ success: false, msg: 'Subcategory name and category (ID or name) are required' });
  // }

  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    const parentCategory = await findCategoryByIdOrName(categoryValue);
    if (!parentCategory) {
      return res.status(400).json({ success: false, msg: 'Parent category not found. Check ID or name.' });
    }

    const existingSubcategory = await Subcategory.findOne({ name, parent_category_id: parentCategory._id });
    if (existingSubcategory) {
      return res.status(400).json({ success: false, msg: 'Subcategory with this name already exists under this category' });
    }

    const newSubcategoryData = {
      name,
      parent_category_id: parentCategory._id,
      status
    };
    if (image) newSubcategoryData.image = image; // Add image if uploaded

    const newSubcategory = new Subcategory(newSubcategoryData);

    await newSubcategory.save();
    await newSubcategory.populate('parent_category_id', 'name _id');

    // Bidirectional: Add to parent's array if implemented
    await Category.findByIdAndUpdate(parentCategory._id, { $addToSet: { subcategories: newSubcategory._id } });

    // Transform response to match get/update format: hide name and parent_category_id, add parentCategory and subcategoryName
    const { name: subName, parent_category_id, ...rest } = newSubcategory.toObject();
    const formattedSubcategory = {
      ...rest,
      parentCategory: {
        id: newSubcategory.parent_category_id._id,
        name: newSubcategory.parent_category_id.name
      },
      subcategoryName: subName  // Use destructured original name
    };

    res.status(201).json({ 
      success: true,
      msg: 'Subcategory created successfully',
      subcategory: formattedSubcategory 
    });
  } catch (err) {
    console.error('Subcategory creation error:', err);
    // Clean up uploaded file if error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, msg: 'Server error during subcategory creation' });
  }
}


exports.getAllSubcategories = async (req, res) => {
  const { page = 1, limit = 10, category, status, name } = req.query;
  const filter = {};
  if (category) {
    const cat = await findCategoryByIdOrName(category);
    if (cat) filter.parent_category_id = cat._id;
    else return res.status(400).json({ success: false, msg: 'Invalid category filter' });
  }
  if (status) filter.status = status;
  if (name) filter.name = { $regex: name, $options: 'i' };

  try {
    const subcategories = await Subcategory.find(filter)
      .populate('parent_category_id', 'name _id')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Subcategory.countDocuments(filter);

    // Aggregate product count per subcategory
    const subcategoryProductCounts = await Product.aggregate([
      {
        $group: {
          _id: '$subcategory', // Group by subcategory ID
          productCount: { $sum: 1 } // Count the number of products per subcategory
        }
      }
    ]);

    // Convert product counts into a map for easy lookup
    const productCountMap = new Map(subcategoryProductCounts.map(item => [item._id.toString(), item.productCount]));

    // Transform response to explicitly include parent category details by name and ID
    const formattedSubcategories = subcategories.map(sub => {
      const subObj = sub.toObject();
      const parent = subObj.parent_category_id || {}; // Prevent null access
      return {
        ...subObj,
        parentCategory: {
          id: parent._id || null,
          name: parent.name || 'Unknown',
        },
        subcategoryName: subObj.name,
        productCount: productCountMap.get(subObj._id.toString()) || 0 // Add product count, default to 0 if none
      };
    });

    res.json({
      success: true,
      subcategories: formattedSubcategories, // Use formatted version with productCount
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    console.error('Subcategory list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching subcategories' });
  }
};



exports.getsubcategoryById = async (req, res) => {
  try {
    const subcategory = await Subcategory.findById(req.params.id).populate('parent_category_id', 'name _id');  // Include both name and _id for parent category
    if (!subcategory) {
      return res.status(404).json({ success: false, msg: 'Subcategory not found' });
    }

    // Transform response to explicitly include parent category details by name and ID
    // Hide the original 'name' and 'parent_category_id' fields by destructuring them out
    const { name: subName, parent_category_id, ...rest } = subcategory.toObject();
    const formattedSubcategory = {
      ...rest,
      parentCategory: {
        id: subcategory.parent_category_id._id,
        name: subcategory.parent_category_id.name
      },
      subcategoryName: subName  // Explicitly highlight subcategory name (from original)
    };

    res.json({ success: true, subcategory: formattedSubcategory });
  } catch (err) {
    console.error('Subcategory get error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching subcategory' });
  }
}

exports.updateSubcategory = async (req, res) => {
  const { name, parent_category_id: categoryValue, status } = req.body;
  const image = req.file ? req.file.path : null;

  // Validate status if provided
  if (status !== undefined && !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  let parentCategory = null;
  if (categoryValue !== undefined) {
    parentCategory = await findCategoryByIdOrName(categoryValue);
    if (!parentCategory) {
      return res.status(400).json({ success: false, msg: 'Parent category not found. Check ID or name.' });
    }
  }

  try {
    // Validate subcategory ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid subcategory ID format' });
    }

    // Fetch current subcategory to check for old image deletion
    const currentSubcategory = await Subcategory.findById(req.params.id);
    if (!currentSubcategory) {
      return res.status(404).json({ success: false, msg: 'Subcategory not found' });
    }

    // Build update data (only include provided fields)
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (parentCategory) updateData.parent_category_id = parentCategory._id;
    if (image !== null) updateData.image = image; // Update image if new file uploaded

    // If no fields to update, return error
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    const subcategory = await Subcategory.findByIdAndUpdate(
      req.params.id, 
      updateData, 
      { new: true, runValidators: true }
    ).populate('parent_category_id', 'name _id');

    // Optional: Delete old image file if new one uploaded
    if (image && currentSubcategory.image && currentSubcategory.image !== image) {
      // fs.unlinkSync(currentSubcategory.image); // Uncomment if you want to delete old file
    }

    // Handle bidirectional update if category changed
    if (parentCategory && subcategory.parent_category_id.toString() !== parentCategory._id.toString()) {
      // Remove from old parent
      const oldCategoryId = currentSubcategory.parent_category_id; // Use old category ID
      await Category.findByIdAndUpdate(oldCategoryId, { $pull: { subcategories: subcategory._id } });
      // Add to new parent
      await Category.findByIdAndUpdate(parentCategory._id, { $addToSet: { subcategories: subcategory._id } });
    }

    // Transform response to match get/create format: hide name and parent_category_id, add parentCategory and subcategoryName
    const { name: subName, parent_category_id, ...rest } = subcategory.toObject();
    const formattedSubcategory = {
      ...rest,
      parentCategory: {
        id: subcategory.parent_category_id._id,
        name: subcategory.parent_category_id.name
      },
      subcategoryName: subName  // Use destructured original name
    };

    res.json({ 
      success: true,
      msg: 'Subcategory updated successfully',
      subcategory: formattedSubcategory 
    });
  } catch (err) {
    console.error('Subcategory update error details:', err); // Enhanced log
    // Clean up uploaded file if error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${err.message}` });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, msg: 'Invalid ID format' });
    }
    res.status(500).json({ success: false, msg: 'Server error updating subcategory' });
  }
}

exports.deleteSubcategory = async (req, res) => {
  try {
    const subcategory = await Subcategory.findById(req.params.id);
    if (!subcategory) {
      return res.status(404).json({ success: false, msg: 'Subcategory not found' });
    }

    // Bidirectional: Remove from parent
    await Category.findByIdAndUpdate(subcategory.parent_category_id, { $pull: { subcategories: subcategory._id } });

    // Optional: Delete image file
    // if (subcategory.image && fs.existsSync(subcategory.image)) {
    //   fs.unlinkSync(subcategory.image);
    // }

    await Subcategory.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Subcategory deleted successfully' });
  } catch (err) {
    console.error('Subcategory delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting subcategory' });
  }
}