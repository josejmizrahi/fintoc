-- Atomic switch-company function to prevent race conditions
CREATE OR REPLACE FUNCTION switch_active_company(p_user_id uuid, p_company_id integer)
RETURNS void AS $$
BEGIN
  UPDATE user_companies SET is_active = false
  WHERE user_id = p_user_id AND is_active = true;

  UPDATE user_companies SET is_active = true
  WHERE user_id = p_user_id AND company_id = p_company_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % is not an active member of company %', p_user_id, p_company_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
