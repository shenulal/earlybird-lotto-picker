# Earlybird Lottery Picker

A beautiful, interactive web-based lottery picker with slot machine animation, confetti effects, and comprehensive winner tracking.

## Features

- 🎰 **Slot Machine Animation**: Smooth rolling animation with realistic slot machine feel
- 🎊 **Confetti Effects**: Celebratory confetti animation when a winner is selected
- 📊 **Real-time Statistics**: Track total prizes, remaining prizes, and winners count
- 🏆 **Winners List**: Complete history of all winners with timestamps
- 🔄 **Reset Functionality**: Reset the lottery to start over with all tickets
- 📱 **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- 🎨 **Beautiful UI**: Modern gradient background with glassmorphism effects

## Project Structure

```
earlybird-lotto-picker/
├── index.html          # Main HTML file
├── styles.css          # CSS styles and animations
├── script.js           # JavaScript functionality
├── tickets.json        # Lottery tickets data
├── appsettings.json    # Application configuration
└── README.md          # This file
```

## Setup and Usage

### Local Development

1. **Clone or download** this project to your local machine
2. **Update tickets data**: Edit `tickets.json` to include your actual lottery tickets
3. **Serve the files**: Use a local web server to serve the files (required for JSON loading)

#### Option 1: Using Python (if installed)
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

#### Option 2: Using Node.js (if installed)
```bash
# Install a simple server globally
npm install -g http-server

# Run the server
http-server
```

#### Option 3: Using Live Server (VS Code Extension)
- Install the "Live Server" extension in VS Code
- Right-click on `index.html` and select "Open with Live Server"

4. **Open in browser**: Navigate to `http://localhost:8000` (or the port shown by your server)

### Configuration

#### Application Settings (`appsettings.json`)

Configure your lottery event by editing the `appsettings.json` file:

```json
{
  "appSettings": {
    "totalPrizes": 10,
    "eventName": "Earlybird Lottery 2024",
    "organizationName": "Your Organization",
    "animation": {
      "rollingSpeed": 80,
      "confettiDuration": 5000,
      "confettiCount": 150
    },
    "display": {
      "showMobileInWinner": true,
      "showTicketIdInAnimation": true,
      "autoStopWhenPrizesExhausted": true
    },
    "ui": {
      "primaryColor": "#ffeb3b",
      "backgroundColor": "radial-gradient(circle at top, #1d2671, #c33764)",
      "showOrganizationName": true
    }
  }
}
```

**Configuration Options:**
- `totalPrizes`: Maximum number of prizes to be awarded
- `eventName`: Name of your lottery event (appears in title and heading)
- `organizationName`: Your organization name (optional display)
- `animation.rollingSpeed`: Speed of slot machine animation in milliseconds
- `animation.confettiDuration`: How long confetti animation lasts
- `animation.confettiCount`: Number of confetti pieces
- `display.showMobileInWinner`: Whether to show mobile numbers in winner display
- `ui.primaryColor`: Primary color for highlights and animations

#### Adding Your Tickets (`tickets.json`)

Edit the `tickets.json` file to include your actual lottery participants:

```json
{
  "tickets": [
    {
      "ticket": "TICKET-001",
      "name": "John Doe",
      "college": "Example University",
      "mobile": "+91 9876543210",
      "processed": 0
    },
    {
      "ticket": "TICKET-002",
      "name": "Jane Smith",
      "college": "Another College",
      "mobile": "+91 9876543211",
      "processed": 0
    }
  ]
}
```

**Ticket Fields:**
- `ticket`: Unique ticket identifier
- `name`: Participant's full name
- `college`: Institution or organization
- `mobile`: Contact number (optional)
- **Important**: Keep `"processed": 0` for all tickets initially

## How to Use

1. **Start the Lottery**: Click the "Start" button to begin the slot machine animation
2. **Stop and Select Winner**: Click the "Stop" button to select a random winner
3. **View Winners**: Check the winners list below to see all selected winners
4. **Reset**: Use the "Reset All" button to start over with all tickets available again

## Features Explained

### Fair Random Selection
- Uses cryptographically secure random number generation
- Each ticket has an equal chance of being selected
- Once selected, tickets are marked as processed and won't be selected again

### Statistics Tracking
- **Total Prizes**: Shows the maximum number of prizes that can be awarded
- **Remaining Prizes**: Shows how many prizes are still available
- **Winners**: Shows the total number of winners selected so far

### Winner History
- Complete list of all winners with selection order
- Includes ticket number, name, college, and timestamp
- Automatically updates after each selection

### Reset Functionality
- Resets all tickets back to unprocessed state
- Clears the winners list
- Reshuffles the tickets for fair distribution

## Browser Compatibility

This application works in all modern browsers including:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Technical Details

- **Pure JavaScript**: No external dependencies required
- **Responsive CSS**: Mobile-first design with flexbox and grid
- **Canvas Animation**: Hardware-accelerated confetti effects
- **JSON Data Loading**: Asynchronous data loading with error handling
- **Local Storage**: Could be extended to save state between sessions

## Customization

### Styling
Edit `styles.css` to customize:
- Colors and gradients
- Animation speeds
- Layout and spacing
- Responsive breakpoints

### Animation
Modify `script.js` to adjust:
- Slot machine rolling speed (line 80: `80` milliseconds)
- Confetti duration (line 180: `5000` milliseconds)
- Number of confetti pieces (line 175: `150` pieces)

### Data Structure
The `tickets.json` file supports additional fields if needed:
```json
{
  "ticket": "ID",
  "name": "Full Name",
  "college": "Institution",
  "processed": 0,
  "email": "optional@email.com",
  "phone": "optional-phone",
  "category": "optional-category"
}
```

## License

This project is open source and available under the MIT License.
