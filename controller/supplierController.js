const Supplier = require('../model/Suppliar');


// Create a new supplier
exports.createSupplier = async (req, res) => {
    try {
        const supplier = new Supplier(req.body);
        await supplier.save();
        res.status(201).json(supplier);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
}