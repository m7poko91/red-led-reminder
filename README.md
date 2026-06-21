# red-led-reminder

Nightly text reminder service for doing a red LED laser session.

The service:

- Sends a text every night at 9:00 PM in your configured timezone.
- Texts: "Hi. This is your 9 PM reminder to do your red LED laser. Reply DONE when you complete it."
- Marks the night complete when you reply `DONE`, `OK`, `YES`, or a similar acknowledgment.
- Sends one follow-up text 2 minutes later if you have not acknowledged the reminder.
- Stops after the configured retry limit so it does not create an unlimited text loop.

The app must be running with valid SMS provider credentials at 9 PM for the scheduled text to happen. If it is not deployed/running, no text can be sent.

## Can this be free?

Reliable direct SMS to a phone number normally requires a carrier/SMS provider such as Twilio, and those providers usually charge for outbound texts.

The common no-per-SMS-cost workaround is your carrier's email-to-SMS gateway, for example sending an email to an address like `number@carrier-gateway.example`. That can be free, but it depends on your current mobile carrier, is less reliable than a real SMS provider, and may not support delivery/status webhooks consistently. If you want that option, find your carrier's SMS gateway address for `847-344-2559` and use an email sender/SMTP account.

## How it works

This is a small TypeScript/Node service:

- `node-cron` schedules the nightly 9 PM trigger.
- Twilio Messaging sends the reminder text.
- Inbound SMS replies acknowledge the reminder.
- JSON state in `STATE_FILE_PATH` tracks each night's attempts and acknowledgment status.

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

   - `TARGET_PHONE_NUMBER`: `+18473442559`
   - `TWILIO_FROM_NUMBER`: your Twilio SMS-capable number
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

## Trigger a missed reminder manually

If the service was not running at 9 PM, configure `.env` and run:

```sh
npm run call-now
```

or:

```sh
npm run text-now
```

This uses the same idempotency rules as the nightly scheduler: it will not text again if the current local date has already been acknowledged or has an active retry scheduled.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `REMINDER_CRON_EXPRESSION` | `0 21 * * *` | Runs at 9 PM daily. |
| `REMINDER_TIMEZONE` | `TZ` or `America/Chicago` | Timezone used by the scheduler and nightly date key. |
| `RETRY_DELAY_MS` | `120000` | Delay before retrying an unacknowledged text. |
| `MAX_RETRY_ATTEMPTS` | `1` | Additional texts after the first unacknowledged text. |
| `REMINDER_MESSAGE` | Red LED reminder text | Sent in the SMS reminder. |
| `STATE_FILE_PATH` | `./data/reminder-state.json` | Persistent reminder state. |
| `TWILIO_VALIDATE_WEBHOOK_SIGNATURE` | `false` | Set to `true` in production after `WEBHOOK_BASE_URL` exactly matches Twilio's callback URLs. |

## Webhook endpoints

Twilio status callbacks are received at:

```text
POST /webhooks/twilio/message-status
```

Inbound replies are received at:

```text
POST /webhooks/twilio/incoming-message
```

Configure the Twilio phone number's inbound messaging webhook to use `/webhooks/twilio/incoming-message`. The service passes the status callback URL to Twilio when it creates each outbound message, including the reminder date and attempt id as query parameters.

## Tests

```sh
npm test
```
