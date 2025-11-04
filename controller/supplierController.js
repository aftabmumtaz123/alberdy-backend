const Supplier = require('../model/Suppliar');

// Create a new supplier
exports.createSupplier = async (req, res) => {
  try {
    const supplier = new Supplier(req.body);
    await supplier.save();

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: supplier,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating supplier',
        error: error.message,
    });
};
}


// Get all suppliers
exports.getAllSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find();
    res.status(200).json({
        success: true,
        message: 'Suppliers fetched successfully',
        data: suppliers,
    });
  }
    catch (error) {
    res.status(500).json({
        success: false,
        message: 'Error fetching suppliers',
        error: error.message,
    });
  }
}