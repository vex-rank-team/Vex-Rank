'use client';
import type { ReactNode } from 'react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export function FilterInput({ value, onChange, placeholder, icon, label }: {value:string;onChange:(value:string)=>void;placeholder:string;icon?:ReactNode;label?:string}) {
  return <label className="relative">{icon && <span className="absolute left-0 top-2.5 text-white/45 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}<input value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} aria-label={label??placeholder} className={`h-9 w-full border-0 border-b border-white/15 bg-transparent pr-3 text-sm outline-none placeholder:text-white/45 focus:border-white/40 ${icon ? 'pl-6' : 'pl-0'}`} /></label>;
}

export function FilterSelect({ label, value, options, onChange, className='', allLabel, optionLabels={} }: {label:string;value:string;options:string[];onChange:(value:string)=>void;className?:string;allLabel?:string;optionLabels?:Record<string,string>}) {
  return <NativeSelect value={value} onChange={event=>onChange(event.target.value)} className={`w-full [&_select]:h-9 [&_select]:rounded-none [&_select]:border-0 [&_select]:border-b [&_select]:border-white/15 [&_select]:bg-transparent dark:[&_select]:bg-transparent dark:[&_select]:hover:bg-white/[.03] [&_select]:px-0 [&_select]:text-sm ${className}`} aria-label={label}>{options.map(option=><NativeSelectOption key={option} value={option}>{optionLabels[option]??(option === 'All' ? (allLabel ?? `All ${label.toLowerCase()}s`) : option)}</NativeSelectOption>)}</NativeSelect>;
}
