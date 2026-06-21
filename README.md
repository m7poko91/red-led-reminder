# red-led-reminder

Nightly phone reminder service for doing a red LED laser session.

The service:

- Places an outbound call every night at 9:00 PM in your configured timezone.
- Says: "Hi. This is your 9 PM reminder to do your red LED laser."
- Marks the night complete as soon as Twilio reports the call was answered.
- Retries 2 minutes later when Twilio reports `no-answer`, `busy`, `failed`, or `canceled`.
- Stops after the configured retry limit so a bad phone state does not create an unlimited call loop.

## How it works

This is a small TypeScript/Node service:

- `node-cron` schedules the nightly 9 PM trigger.
- Twilio Voice places the outbound reminder call.
- Twilio status callbacks report whether the call was answered or missed.
- JSON state in `STATE_FILE_PATH` tracks each night's attempts and answer status.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

3. Fill in `.env`:

   - `TARGET_PHONE_NUMBER`: your phone number, for example `+15551234567`
   - `TWILIO_FROM_NUMBER`: your Twilio voice-capable number
   - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
   - `WEBHOOK_BASE_URL`: a public HTTPS URL for this service
   - `REMINDER_TIMEZONE`: the timezone where 9 PM should be interpreted

4. Start the service:

   ```sh
   npm run dev
   ```

For production, build and run:

```sh
npm run build
npm start
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `REMINDER_CRON_EXPRESSION` | `0 21 * * *` | Runs at 9 PM daily. |
| `REMINDER_TIMEZONE` | `TZ` or `UTC` | Timezone used by the scheduler and nightly date key. |
| `RETRY_DELAY_MS` | `120000` | Delay before retrying a missed call. |
| `MAX_RETRY_ATTEMPTS` | `1` | Additional calls after the first missed call. |
| `REMINDER_MESSAGE` | Red LED reminder text | Spoken by Twilio during the call. |
| `STATE_FILE_PATH` | `./data/reminder-state.json` | Persistent reminder state. |
| `TWILIO_VALIDATE_WEBHOOK_SIGNATURE` | `false` | Set to `true` in production after `WEBHOOK_BASE_URL` exactly matches Twilio's callback URL. |

## Webhook endpoint

Twilio status callbacks are received at:

```text
POST /webhooks/twilio/call-status
```

The service passes the callback URL to Twilio when it creates each outbound call, including the reminder date and attempt id as query parameters.

## Tests

```sh
npm test
```
