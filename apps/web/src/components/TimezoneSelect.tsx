import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TIMEZONES = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC')];

/** Every IANA zone the browser knows, with the current value kept even if it's unusual. */
export function TimezoneSelect(props: {
  id: string;
  value: string | undefined;
  onChange: (tz: string) => void;
  disabled?: boolean;
}) {
  const value = props.value ?? 'UTC';
  const zones = TIMEZONES.includes(value) ? TIMEZONES : [value, ...TIMEZONES];
  return (
    <Select value={value} onValueChange={props.onChange} disabled={props.disabled}>
      <SelectTrigger id={props.id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {zones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replaceAll('_', ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
