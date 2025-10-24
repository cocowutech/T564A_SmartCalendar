# OpenAI API Key Setup Guide

## The Error You're Seeing

```
Error code: 401 - {'error': {'message': 'Incorrect API key provided...'}}
```

This means your OpenAI API key is either:
1. Not set
2. Invalid
3. Expired
4. Missing required permissions

## How to Fix

### Step 1: Get a Valid OpenAI API Key

1. Go to: https://platform.openai.com/api-keys
2. Sign in to your OpenAI account (create one if needed)
3. Click **"Create new secret key"**
4. Give it a name like "Smart Calendar"
5. **Copy the key immediately** (you won't be able to see it again!)
   - It should start with `sk-proj-` or `sk-`

### Step 2: Add Key to .env File

1. Open the `.env` file in the project root:
   ```bash
   nano .env
   ```

2. Find this line:
   ```
   OPENAI_API_KEY=your-openai-api-key-here
   ```

3. Replace `your-openai-api-key-here` with your actual key:
   ```
   OPENAI_API_KEY=sk-proj-abc123def456...
   ```

4. Save and close the file (Ctrl+X, then Y, then Enter if using nano)

### Step 3: Restart the Server

```bash
# Stop the current server (Ctrl+C)
# Then restart:
./start.sh
```

Or if running manually:
```bash
uvicorn app.main:app --reload
```

## Verify It Works

1. Open the app: http://localhost:8000
2. In the "Add Smart Activity" section, type:
   ```
   I want to study every Monday at 7pm for 2 hours
   ```
3. Click **"Generate Suggestions"**
4. You should see AI-generated time slot suggestions (not an error)

## Common Issues

### Issue: "I don't have an OpenAI account"
**Solution:** Create one at https://platform.openai.com/signup
- Free tier available
- Credit card required after free credits expire

### Issue: "My key expired"
**Solution:** 
- Keys can expire or be revoked
- Create a new key and update `.env`

### Issue: "Still getting 401 error"
**Solutions:**
1. Check for extra spaces in `.env` file
2. Make sure no quotes around the key
3. Verify key starts with `sk-proj-` or `sk-`
4. Try creating a brand new key

### Issue: "Feature works but very slow"
**Solution:**
- Normal! OpenAI API calls take 2-5 seconds
- The app shows "AI is analyzing..." message while waiting

## What Features Need OpenAI API Key?

These features will **not work** without a valid key:
- ✗ "Generate Suggestions" - Smart time slot finder
- ✗ Natural language event parsing
- ✗ Recurring event scheduling
- ✗ Voice command interpretation

These features **still work** without OpenAI:
- ✓ Manual calendar sync (Google, Canvas)
- ✓ View events
- ✓ Delete events
- ✓ Week navigation
- ✓ All-day events display

## Alternative: Skip Natural Language Features

If you don't want to use OpenAI API:

1. Comment out the OpenAI key in `.env`:
   ```
   # OPENAI_API_KEY=your-key-here
   ```

2. The app will still run but will show error messages when trying to use AI features

3. You can still use all calendar viewing and syncing features

## Security Notes

- **Never commit** your API key to git
- `.env` should be in `.gitignore`
- Don't share your API key publicly
- Rotate keys regularly for security

## Cost Information

- OpenAI charges per API call
- GPT-4 is more expensive than GPT-3.5
- Typical usage: ~$0.01-0.05 per natural language request
- Monitor usage: https://platform.openai.com/usage

## Need Help?

Check these resources:
- OpenAI API Docs: https://platform.openai.com/docs
- API Key Management: https://platform.openai.com/api-keys
- Billing: https://platform.openai.com/account/billing

