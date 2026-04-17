# POS System - How to Run

## Quick Start (Recommended for Development)

**Double-click:** `quick-start.bat`

This will:
1. Check if Node.js is installed
2. Install dependencies (first time only)
3. Start the development server
4. Open browser automatically at http://localhost:3000

---

## Advanced Options

### 1. Main Runner Script
**File:** `run.bat`

**Usage:**
```bash
run.bat [MODE] [OPTIONS]
```

**Modes:**
- `run.bat dev` - Start development server (default)
- `run.bat build` - Build for production
- `run.bat start` - Start production server
- `run.bat clean` - Clean cache and temporary files
- `run.bat check` - Check system and test build

**Examples:**
```bash
run.bat                    # Start development server
run.bat dev port 3001      # Start on port 3001
run.bat build              # Build for production
run.bat start              # Start production server
run.bat clean              # Clean temporary files
run.bat check              # Check system health
```

### 2. Production Server
**Double-click:** `run-production.bat`

This will:
1. Check if production build exists
2. Build if needed (takes a few minutes)
3. Start production server
4. Open browser at http://localhost:3000

### 3. Create Desktop Shortcut
**Double-click:** `create-desktop-shortcut.bat`

This creates a "POS System" shortcut on your desktop for easy access.

---

## System Requirements

### Required Software
- **Node.js** (v14 or higher)
  - Download from: https://nodejs.org/
  - During installation, accept all defaults

- **SQL Server** (for database)
  - SQL Server Express (free) or full version
  - Make sure SQL Server service is running

### Windows Requirements
- Windows 10 or higher
- Administrator privileges (recommended for first setup)

---

## Database Setup

### 1. SQL Server Configuration
Make sure SQL Server is running with these settings:
- Server name: `DESKTOP-EUN2CV2` (or your server name)
- Database: `HawaiDB`
- Authentication: SQL Server Authentication
- Username: `it`
- Password: `123`

### 2. Environment Configuration
Create or update `.env.local` file in the pos-system directory:

```env
# Database Configuration
DB_SERVER=DESKTOP-EUN2CV2
DB_NAME=HawaiDB
DB_USER=it
DB_PASSWORD=123
DB_ENCRYPT=false
DB_TRUST_CERT=true

# Next.js Configuration
NODE_ENV=development
```

### 3. Test Database Connection
Run: `run.bat check`
This will test database connectivity and build process.

---

## Troubleshooting

### Common Issues

#### 1. "Node.js not found"
**Solution:** Install Node.js from https://nodejs.org/
Restart your computer after installation.

#### 2. "Database connection failed"
**Solutions:**
- Make sure SQL Server is running
- Check SQL Server service in Services.msc
- Verify database credentials in .env.local
- Test connection with SQL Server Management Studio

#### 3. "Port 3000 already in use"
**Solutions:**
- Close other applications using port 3000
- Or use different port: `run.bat dev port 3001`

#### 4. "Build failed"
**Solutions:**
- Run `run.bat clean` to clear cache
- Run `run.bat check` to diagnose issues
- Make sure all dependencies are installed

#### 5. "Access denied" errors
**Solutions:**
- Run Command Prompt as Administrator
- Check folder permissions
- Make sure antivirus isn't blocking Node.js

### Performance Issues

#### Slow Development Server
- Run `run.bat clean` to clear cache
- Close unnecessary applications
- Make sure you have enough RAM (4GB+ recommended)

#### Build Takes Too Long
- This is normal for first build (2-5 minutes)
- Subsequent builds are faster
- Use SSD for better performance

---

## Development vs Production

### Development Mode (`quick-start.bat` or `run.bat dev`)
- ✅ Fast startup
- ✅ Hot reload (changes appear immediately)
- ✅ Detailed error messages
- ✅ Source maps for debugging
- ❌ Slower performance
- ❌ Not optimized for production

### Production Mode (`run-production.bat` or `run.bat start`)
- ✅ Optimized performance
- ✅ Minified code
- ✅ Ready for real use
- ❌ Slower startup (needs build first)
- ❌ No hot reload
- ❌ Less detailed errors

---

## Advanced Configuration

### Custom Port
```bash
run.bat dev port 8080    # Use port 8080
run.bat start port 8080  # Production on port 8080
```

### Environment Variables
Create `.env.local` for local settings:
```env
PORT=3000
DB_SERVER=localhost
DB_NAME=MySalonDB
```

### Custom Database
Update `.env.local` with your database settings:
```env
DB_SERVER=YOUR_SERVER_NAME
DB_NAME=YOUR_DATABASE_NAME
DB_USER=YOUR_USERNAME
DB_PASSWORD=YOUR_PASSWORD
```

---

## File Structure

```
pos-system/
├── run.bat                    # Main runner script
├── quick-start.bat            # Quick development start
├── run-production.bat         # Production server
├── create-desktop-shortcut.bat # Desktop shortcut creator
├── README-RUN.md             # This file
├── package.json              # Node.js dependencies
├── .env.local                # Environment variables (create this)
├── src/                      # Source code
├── .next/                    # Production build (auto-generated)
└── node_modules/             # Dependencies (auto-generated)
```

---

## Getting Help

### Check System Health
```bash
run.bat check
```
This will:
- Verify Node.js installation
- Check dependencies
- Test TypeScript compilation
- Test build process
- Check database connection

### View Logs
- Development logs appear in the terminal
- Check browser console for frontend errors
- SQL Server logs for database issues

### Reset Everything
```bash
run.bat clean
# Then
run.bat dev
```

---

## Security Notes

### Production Deployment
- Change default database passwords
- Use HTTPS in production
- Set up proper firewall rules
- Regular database backups
- Update Node.js and dependencies regularly

### Development Safety
- Don't commit .env.local to version control
- Use strong database passwords
- Keep your system updated

---

## Support

If you encounter issues:
1. Run `run.bat check` first
2. Check the troubleshooting section above
3. Make sure all requirements are installed
4. Verify database connection

The system is designed to be easy to run and maintain. Most issues are resolved by:
- Installing/updating Node.js
- Checking database connection
- Running the clean command
- Using the correct batch file for your needs
