const Currency = require('../model/Currency');

// 🟢 Create Currency
exports.createCurrency = async (req, res) => {
  try {
    const { currency_name, currency_symbol } = req.body;

    if (!currency_name || !currency_symbol) {
      return res.status(400).json({
        success: false,
        message: 'Both currency_name and currency_symbol are required',
      });
    }

    const existing = await Currency.findOne({
      currency_name: { $regex: `^${currency_name}$`, $options: 'i' },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Currency already exists',
      });
    }

    const newCurrency = new Currency({ currency_name, currency_symbol });
    await newCurrency.save();

    res.status(201).json({
      success: true,
      message: 'Currency created successfully',
      data: newCurrency,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟡 Get All Currencies (with pagination + search)
exports.getAllCurrencies = async (req, res) => {
  try {
    const { page = 1, limit , search = '' } = req.query;

    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.max(parseInt(limit, 10), 1);

    // Search filter (case-insensitive)
    const filter = search
      ? {
          $or: [
            { currency_name: { $regex: search, $options: 'i' } },
            { currency_symbol: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const totalCurrencies = await Currency.countDocuments(filter);

    const currencies = await Currency.find(filter)
      .sort({ currency_name: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json({
      success: true,
      message: 'Currencies fetched successfully',
      data: currencies,
      pagination: {
        total: totalCurrencies,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCurrencies / limitNum),
        hasNextPage: pageNum * limitNum < totalCurrencies,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟣 Get Currency by ID
exports.getCurrencyById = async (req, res) => {
  try {
    const currency = await Currency.findById(req.params.id);
    if (!currency) {
      return res.status(404).json({
        success: false,
        message: 'Currency not found',
      });
    }
    res.json({
      success: true,
      message: 'Currency fetched successfully',
      data: currency,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟠 Update Currency
exports.updateCurrency = async (req, res) => {
  try {
    const { currency_name, currency_symbol } = req.body;

     const existing = await Currency.findOne({
      currency_name: { $regex: `^${currency_name}$`, $options: 'i' },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Currency already exists',
      });
    }

    const updatedCurrency = await Currency.findByIdAndUpdate(
      req.params.id,
      { currency_name, currency_symbol },
      { new: true, runValidators: true }
    );

    if (!updatedCurrency) {
      return res.status(404).json({
        success: false,
        message: 'Currency not found',
      });
    }

    res.json({
      success: true,
      message: 'Currency updated successfully',
      data: updatedCurrency,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔴 Delete Currency
exports.deleteCurrency = async (req, res) => {
  try {
    const deletedCurrency = await Currency.findByIdAndDelete(req.params.id);
    if (!deletedCurrency) {
      return res.status(404).json({
        success: false,
        message: 'Currency not found',
      });
    }
    res.json({
      success: true,
      message: 'Currency deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
