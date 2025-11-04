
const Category = require('../model/Category'); 
const Subcategory = require('../model/subCategory')



exports.createCategory =  async (req, res) => {
  const { name, description, status = 'Active' } = req.body;

   const image = req.file ? req.file.path : null;



  if (!name) {
    return res.status(400).json({ success: false, msg: 'Category name is required' });
  }

  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ success: false, msg: 'Category with this name already exists' });
    }

    const newCategory = new Category({
      name,
      image,
      description,
      status,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await newCategory.save();
    res.status(201).json({
      success: true,
      msg: 'Category created successfully',
      category: newCategory
    });
  } catch (err) {
    console.error('Category creation error:', err);
    res.status(500).json({ success: false, msg: 'Server error during category creation' });
  }
}

exports.getCategories =  async (req, res) => {
  const { page = 1, limit = 10, status, name } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (name) filter.name = { $regex: name, $options: 'i' };

  try {
    const categories = await Category.find(filter)
      .populate('subcategories', 'name status') // ADD: Populate _id, name, status
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Category.countDocuments(filter);

    res.json({ 
      success: true,
      categories,  // Now includes populated subcategories array
      total, 
      pages: Math.ceil(total / limit),
      currentPage: page 
    });
  } catch (err) {
    console.error('Category list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching categories' });
  }
}

exports.getCategoryById =   async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('subcategories', 'name status'); // ADD: Populate _id, name, status
    if (!category) {
      return res.status(404).json({ success: false, msg: 'Category not found' });
    }
    res.json({ success: true, category });
  } catch (err) {
    console.error('Category get error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching category' });
  }
}
exports.updateCategory = async (req, res) => {
  const { name, description, status } = req.body;



  try {
    const existingCategory = await Category.findById(req.params.id);
    if (!existingCategory) {
      return res.status(404).json({ success: false, msg: 'Category not found' });
    }

    const image = req.file ===  ? req.file.path : existingCategory.image;


    existingCategory.name = name ?? existingCategory.name;
    existingCategory.description = description ?? existingCategory.description;
    existingCategory.status = status;
    existingCategory.image = image;

    await existingCategory.save();

    res.json({
      success: true,
      msg: 'Category updated successfully',
      category: existingCategory
    });
  } catch (err) {
    console.error('Category update error:', err);
    res.status(500).json({ success: false, msg: 'Server error updating category' });
  }
};


exports.deleteCategory =  async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, msg: 'Category not found' });
    }
    await Subcategory.deleteMany({ category: req.params.id });
    res.json({ success: true, msg: 'Category deleted successfully' });
  } catch (err) {
    console.error('Category delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting category' });
  }

}
