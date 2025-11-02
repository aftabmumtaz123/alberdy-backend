const ContactUs = require("../model/ContactUs");

// Handle contact form submission
exports.submitContactForm = async (req, res) => {
  try {
    const { name, email, message, subject } = req.body;

    const contact = new ContactUs({
      name,
      email,
      message,
      subject,
    });
    await contact.save();
    res.status(200).json({ status: true, message: "Message submitted successfully." });
  } catch (error) {
    console.error("Error submitting contact form:", error);
    res.status(500).json({ status: false, message: "Error submitting contact form." });
  }
};

exports.getAllContacts = async (req, res) => {
  try {
    //add pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const total = await ContactUs.countDocuments();
    const totalPages = Math.ceil(total / limit);
    const contacts = await ContactUs.find().skip(skip).limit(limit);
    res.status(200).json({ status: true, message: "Contacts fetched successfully.", contacts, totalPages, currentPage: page });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ status: false, message: "Error fetching contacts." });
  }
};
