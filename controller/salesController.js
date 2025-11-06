const Sale = require('../model/Sales');
const Variant = require('../model/variantProduct');
const User = require('../model/User');

exports.createSale = async (req, res) => {
  try {
    const { date, customerId, products, summary, payment, notes } = req.body;

    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
    }

    const customer = await User.findById(customerId);
    if (!customer) return res.status(400).json({ status: false, message: 'Invalid customer' });

    let subTotal = 0;
    let totalQuantity = 0;

    const validatedProducts = [];
    for (let prod of products) {
      if (!prod.variantId || !prod.quantity || !prod.price || !prod.unitCost) {
        return res.status(400).json({ status: false, message: 'Each product must have variantId, quantity, price, and unitCost' });
      }
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive' || variant.stockQuantity < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock or invalid variant: ${prod.variantId}` });
      }
      if (prod.quantity <= 0 || prod.price < 0 || prod.unitCost < 0) {
        return res.status(400).json({ status: false, message: 'Quantity and prices must be positive' });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
      totalQuantity += prod.quantity;
      validatedProducts.push({ 
        variantId: prod.variantId, 
        quantity: prod.quantity, 
        price: prod.price, 
        taxPercent: prod.taxPercent || 0, 
        taxType: prod.taxType, 
        unitCost: prod.unitCost 
      });
    }

    const grandTotal = subTotal + (summary.otherCharges || 0) - (summary.discount || 0);
    if (summary.discount > subTotal) return res.status(400).json({ status: false, message: 'Discount cannot exceed subtotal' });
    if (date && new Date(date) > new Date()) return res.status(400).json({ status: false, message: 'Date cannot be in the future' });

    // Generate unique saleCode
    let saleCode = `SALE-000001`;
    let existing = await Sale.findOne().sort({ saleCode: -1 });
    if (existing) {
      let num = parseInt(existing.saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }
    while (await Sale.findOne({ saleCode })) {
      let num = parseInt(saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }

    const amountDue = grandTotal - (payment?.amount || 0);

    const sale = new Sale({
      saleCode,
      date: date || Date.now(),
      customerId,
      products: validatedProducts,
      payment: { 
        type: payment?.type, 
        amount: payment?.amount || 0, 
        notes: payment?.notes || '' 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        discount: summary.discount || 0, 
        otherCharges: summary.otherCharges || 0, 
        grandTotal 
      },
      notes: notes || '',
    });

    await sale.save();

    // Update inventory
    for (let prod of validatedProducts) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
    }

    res.status(201).json({ status: true, message: 'Sale created successfully', data: sale });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.getAllSales = async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate, paymentStatus, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { isDeleted: false };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (paymentStatus) {
      query = {
        ...query,
        $expr: {
          [paymentStatus === 'Paid' ? '$gte' : '$lt']: [
            '$payment.amount',
            '$summary.grandTotal',
          ],
        },
      };
    }
    if (search) {
      const user = await User.findOne({ name: { $regex: search, $options: 'i' } });
      query.$or = [{ saleCode: { $regex: search, $options: 'i' } }];
      if (user) {
        query.$or.push({ customerId: user._id });
      }
    }

    const sales = await Sale.find(query)
      .sort({ date: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email phone') // Enhanced customer data
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { 
            path: 'product', 
            select: 'name images thumbnail description',
          },
          { 
            path: 'unit', 
            select: 'name symbol' // Assuming Unit model has name/symbol
          }
        ],
      })
      .lean();

    const total = await Sale.countDocuments(query);

    res.status(200).json({
      status: true,
      message: 'Sales fetched successfully',
      data: sales.map((sale) => ({
        id: sale._id,
        date: sale.date,
        saleCode: sale.saleCode,
        // Customer data
        customer: {
          id: sale.customerId?._id,
          name: sale.customerId?.name || 'Unknown',
          email: sale.customerId?.email || '',
          phone: sale.customerId?.phone || '',
        },
        // Payment details
        amountPaid: sale.payment.amount,
        amountDue: sale.summary.grandTotal - sale.payment.amount,
        grandTotal: sale.summary.grandTotal,
        paymentStatus: sale.payment.amount >= sale.summary.grandTotal ? 'Paid' : 'Pending',
        products: sale.products.map((product) => ({
          // Product details
          productName: product.variantId?.product?.name || 'Unknown',
          image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
          unit: product.variantId?.unit?.name || 'Unknown', // Unit name
          quantity: product.quantity,
          // Other product info
          variantId: product.variantId?._id,
          sku: product.variantId?.sku,
          attribute: product.variantId?.attribute,
          value: product.variantId?.value,
          price: product.price,
          productDescription: product.variantId?.product?.description || '',
          categoryName: product.variantId?.product?.category?.name || 'Unknown', // If category is populated further
          brandName: product.variantId?.product?.brand?.name || 'Unknown', // If brand is populated further
        })),
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, customerId, products, summary, payment, notes } = req.body;

    const sale = await Sale.findById(id);
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
    }

    const customer = await User.findById(customerId);
    if (!customer) return res.status(400).json({ status: false, message: 'Invalid customer' });

    // Validate and calculate new totals
    let subTotal = 0;
    let totalQuantity = 0;
    const newProducts = [];
    for (let prod of products) {
      if (!prod.variantId || !prod.quantity || !prod.price || !prod.unitCost) {
        return res.status(400).json({ status: false, message: 'Each product must have variantId, quantity, price, and unitCost' });
      }
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive' || variant.stockQuantity < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock or invalid variant: ${prod.variantId}` });
      }
      if (prod.quantity <= 0 || prod.price < 0 || prod.unitCost < 0) {
        return res.status(400).json({ status: false, message: 'Quantity and prices must be positive' });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
      totalQuantity += prod.quantity;
      newProducts.push({ 
        variantId: prod.variantId, 
        quantity: prod.quantity, 
        price: prod.price, 
        taxPercent: prod.taxPercent || 0, 
        taxType: prod.taxType, 
        unitCost: prod.unitCost 
      });
    }

    const grandTotal = subTotal + (summary.otherCharges || 0) - (summary.discount || 0);
    if (summary.discount > subTotal) return res.status(400).json({ status: false, message: 'Discount cannot exceed subtotal' });
    if (date && new Date(date) > new Date()) return res.status(400).json({ status: false, message: 'Date cannot be in the future' });
    // Removed strict payment match; allow partial payments
    // if (payment.amount !== grandTotal) return res.status(400).json({ status: false, message: 'Payment amount must match grand total' });

    // Adjust inventory: First restore old stock, then deduct new
    const oldProducts = sale.products;
    for (let oldProd of oldProducts) {
      const newProd = newProducts.find(p => p.variantId.toString() === oldProd.variantId.toString());
      const diff = newProd ? oldProd.quantity - newProd.quantity : oldProd.quantity; // Positive diff = restore stock
      if (diff !== 0) {
        await Variant.findByIdAndUpdate(oldProd.variantId, { $inc: { stockQuantity: diff } });
      }
    }

    // Log history
    sale.salesHistory.push({
      action: 'Update',
      changes: { products, summary, payment, notes },
    });

    const amountDue = grandTotal - (payment?.amount || sale.payment.amount);

    sale.set({
      date: date || sale.date,
      customerId,
      products: newProducts,
      payment: { 
        type: payment?.type || sale.payment.type, 
        amount: payment?.amount || sale.payment.amount, 
        notes: payment?.notes || sale.payment.notes || '' 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        discount: summary.discount || 0, 
        otherCharges: summary.otherCharges || 0, 
        grandTotal 
      },
      notes: notes || sale.notes,
    });
    await sale.save();

    // Re-populate for full response with requested fields
    const updatedSale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });

    res.status(200).json({ 
      status: true, 
      message: 'Sale updated successfully', 
      data: updatedSale 
    });
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id)
      .populate('customerId', 'name email phone') // Customer data
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { 
            path: 'product', 
            select: 'name images thumbnail description' // Product name and image
          },
          { 
            path: 'unit', 
            select: 'name symbol' // Unit
          }
        ],
      });
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    // Compute amountDue if not stored
    const amountDue = sale.summary.grandTotal - sale.payment.amount;

    // Enhance response with explicit fields
    const enhancedSale = {
      ...sale.toObject(),
      amountDue,
      products: sale.products.map((product) => ({
        ...product.toObject(),
        productName: product.variantId?.product?.name || 'Unknown',
        image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
        unit: product.variantId?.unit?.name || 'Unknown',
        quantity: product.quantity,
      })),
      customer: {
        id: sale.customerId?._id,
        name: sale.customerId?.name || 'Unknown',
        email: sale.customerId?.email || '',
        phone: sale.customerId?.phone || '',
      },
      amountPaid: sale.payment.amount,
    };

    res.status(200).json({ status: true, data: enhancedSale });
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id);
    if (!sale) return res.status(404).json({ status: false, message: 'Sale not found' });

    sale.isDeleted = true;
    await sale.save();

    // Restore inventory
    for (let prod of sale.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: prod.quantity } });
    }

    // Log history
    sale.salesHistory.push({
      action: 'Delete',
      changes: { isDeleted: true },
    });
    await sale.save();

    res.status(200).json({ status: true, message: 'Sale soft deleted successfully' });
  } catch (error) {
    console.error('Error deleting sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};