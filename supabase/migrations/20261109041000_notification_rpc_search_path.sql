begin;
alter function public.mark_tweaklr_notifications_read(text[]) set search_path = '';
commit;